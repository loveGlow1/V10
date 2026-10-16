/* The terminal bridge: what runs INSIDE a project's sandbox and puts real
 * shells on a WebSocket.
 *
 * Python 3 and nothing else — no packages to install, so a sandbox is ready
 * the moment it boots. It owns:
 *   - shells: real bash on a PTY, one per terminal tab, that outlive any
 *     browser — close the tab, refresh the page, lose the network, and the
 *     shell and whatever it is running carry on;
 *   - replay: each shell's recent output with a sequence number, so a client
 *     that reconnects is sent exactly what it missed, in order;
 *   - auth: a connection must carry a token signed with this sandbox's key
 *     and not yet expired (tokens live 60 seconds; see sandbox.ts);
 *   - shell integration: bash is started with prompt marks (OSC 133, and 633
 *     for the command text) so the client can draw each command as a block
 *     with its exit code and duration;
 *   - ports: servers listening inside the sandbox are reported as they open;
 *   - files: the editor writes the project's files through it, so a dev
 *     server sees an edit the moment it is made.
 *
 * Kept as a string (String.raw: no escapes are touched) so the API can upload
 * it without a bundler rule. No backticks and no dollar-brace inside, which a
 * template literal would read.
 *
 * Protocol: JSON text frames. Client → bridge:
 *   hello {resume: {sid: lastSeq}}      open {s, cols, rows}
 *   i {s, d}       resize {s, cols, rows}       kill {s}
 *   title {s, title}       write {path, content}       ping
 * Bridge → client:
 *   sessions {list}   o {s, q, d(base64)}   exit {s, code}   ports {list}
 *   pong   error {message}
 */

export const BRIDGE_PORT = 7681;
export const BRIDGE_PATH = "/home/user/.quickstark/bridge.py";

export const BRIDGE_SOURCE = String.raw`#!/usr/bin/env python3
import asyncio, base64, collections, errno, fcntl, hashlib, hmac, json, os, pty, signal, struct, sys, termios, time

PORT = int(os.environ.get("QS_BRIDGE_PORT", "7681"))
KEY = os.environ.get("QS_BRIDGE_KEY", "").encode()
PROJECT = os.environ.get("QS_PROJECT_DIR", os.path.expanduser("~/project"))
HOME = os.path.expanduser("~")
BUFFER_BYTES = 4 * 1024 * 1024
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

os.makedirs(PROJECT, exist_ok=True)
QS_DIR = os.path.join(HOME, ".quickstark")
os.makedirs(QS_DIR, exist_ok=True)
RC = os.path.join(QS_DIR, "bashrc")
with open(RC, "w") as rc:
    rc.write(r'''
[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
export TERM=xterm-256color COLORTERM=truecolor
export HISTFILE="$HOME/.quickstark/history" HISTSIZE=10000 HISTFILESIZE=50000 HISTCONTROL=ignoredups
shopt -s histappend checkwinsize
bind 'set enable-bracketed-paste on' 2>/dev/null
__qs_pre() { local c; c="$(HISTTIMEFORMAT= history 1 | sed -e 's/^ *[0-9]* *//')"; printf '\e]633;E;%s\a\e]133;C\a' "$c"; }
__qs_post() { local ec=$?; printf '\e]133;D;%s\a\e]7;file://%s%s\a' "$ec" "$HOSTNAME" "$PWD"; history -a; }
PROMPT_COMMAND=__qs_post
PS0='$(__qs_pre)'
PS1='\[\e]133;A\a\]\[\e[38;5;75m\]\w\[\e[0m\] \[\e[38;5;245m\]\$\[\e[0m\] \[\e]133;B\a\]'
''')

def sign(exp):
    return hmac.new(KEY, exp.encode(), hashlib.sha256).hexdigest()

def authorised(query):
    params = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
    exp, token = params.get("exp", ""), params.get("token", "")
    if not KEY or not exp.isdigit() or int(exp) < time.time():
        return False
    return hmac.compare_digest(sign(exp), token)

class Session:
    def __init__(self, sid, cols, rows):
        self.sid, self.title, self.seq, self.size = sid, "", 0, 0
        self.chunks = collections.deque()
        self.code = None
        env = {k: v for k, v in os.environ.items() if not k.startswith("QS_BRIDGE")}
        env["QS_SESSION"] = sid
        pid, fd = pty.fork()
        if pid == 0:
            try:
                os.chdir(PROJECT)
            except OSError:
                pass
            os.execvpe("bash", ["bash", "--rcfile", RC, "-i"], env)
        self.pid, self.fd = pid, fd
        self.resize(cols, rows)
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        asyncio.get_event_loop().add_reader(fd, self.readable)

    def resize(self, cols, rows):
        try:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", max(2, int(rows)), max(2, int(cols)), 0, 0))
        except OSError:
            pass

    def readable(self):
        try:
            data = os.read(self.fd, 65536)
        except OSError as error:
            data = b"" if error.errno in (errno.EIO, errno.EBADF) else None
            if data is None:
                return
        if not data:
            self.finish()
            return
        self.seq += 1
        self.chunks.append((self.seq, data))
        self.size += len(data)
        while self.size > BUFFER_BYTES and len(self.chunks) > 1:
            self.size -= len(self.chunks.popleft()[1])
        broadcast({"t": "o", "s": self.sid, "q": self.seq, "d": base64.b64encode(data).decode()})

    def finish(self):
        loop = asyncio.get_event_loop()
        try:
            loop.remove_reader(self.fd)
        except Exception:
            pass
        try:
            _, status = os.waitpid(self.pid, 0)
            self.code = os.waitstatus_to_exitcode(status)
        except ChildProcessError:
            self.code = self.code if self.code is not None else 0
        try:
            os.close(self.fd)
        except OSError:
            pass
        SESSIONS.pop(self.sid, None)
        broadcast({"t": "exit", "s": self.sid, "code": self.code})

    def write(self, text):
        data = text.encode()
        while data:
            try:
                n = os.write(self.fd, data)
                data = data[n:]
            except BlockingIOError:
                time.sleep(0.002)
            except OSError:
                return

    def kill(self):
        """The whole process tree: everything in this shell's session, background jobs included."""
        victims = []
        for entry in os.listdir("/proc"):
            if not entry.isdigit():
                continue
            try:
                with open("/proc/%s/stat" % entry) as stat:
                    fields = stat.read().rsplit(")", 1)[1].split()
                if int(fields[3]) == self.pid:
                    victims.append(int(entry))
            except (OSError, IndexError, ValueError):
                continue
        for pid in victims + [self.pid]:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass

    def replay(self, after):
        for seq, data in self.chunks:
            if seq > after:
                yield {"t": "o", "s": self.sid, "q": seq, "d": base64.b64encode(data).decode()}

SESSIONS = {}
CLIENTS = set()
PORTS = []

def describe():
    return [{"s": s.sid, "title": s.title, "seq": s.seq} for s in SESSIONS.values()]

def broadcast(message):
    frame = encode(json.dumps(message))
    for client in list(CLIENTS):
        client.send_frame(frame)

def encode(text, opcode=1):
    payload = text.encode() if isinstance(text, str) else text
    header = bytearray([0x80 | opcode])
    n = len(payload)
    if n < 126:
        header.append(n)
    elif n < 65536:
        header += bytes([126]) + struct.pack(">H", n)
    else:
        header += bytes([127]) + struct.pack(">Q", n)
    return bytes(header) + payload

class Client:
    def __init__(self, reader, writer):
        self.reader, self.writer = reader, writer

    def send_frame(self, frame):
        if self.writer.is_closing():
            CLIENTS.discard(self)
            return
        # A client that cannot keep up is let go rather than buffered without
        # end; it reconnects and is replayed what it missed.
        if self.writer.transport.get_write_buffer_size() > 16 * 1024 * 1024:
            CLIENTS.discard(self)
            self.writer.close()
            return
        self.writer.write(frame)

    def send(self, message):
        self.send_frame(encode(json.dumps(message)))

    async def frames(self):
        buffer = b""
        while True:
            head = await self.reader.readexactly(2)
            fin, opcode = head[0] & 0x80, head[0] & 0x0F
            masked, n = head[1] & 0x80, head[1] & 0x7F
            if n == 126:
                n = struct.unpack(">H", await self.reader.readexactly(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", await self.reader.readexactly(8))[0]
            mask = await self.reader.readexactly(4) if masked else b"\0\0\0\0"
            data = bytearray(await self.reader.readexactly(n))
            for i in range(n):
                data[i] ^= mask[i % 4]
            if opcode == 8:
                return
            if opcode == 9:
                self.send_frame(encode(bytes(data), 10))
                continue
            if opcode in (1, 2, 0):
                buffer += bytes(data)
                if fin:
                    yield buffer.decode("utf-8", "replace")
                    buffer = b""

    def handle(self, message):
        kind = message.get("t")
        sid = str(message.get("s", ""))
        session = SESSIONS.get(sid)
        if kind == "i" and session:
            session.write(message.get("d", ""))
        elif kind == "hello":
            self.send({"t": "sessions", "list": describe()})
            self.send({"t": "ports", "list": PORTS})
            resume = message.get("resume") or {}
            for s in SESSIONS.values():
                for out in s.replay(int(resume.get(s.sid, 0) or 0)):
                    self.send(out)
        elif kind == "open":
            if not session and sid and len(SESSIONS) < 12:
                SESSIONS[sid] = Session(sid, message.get("cols", 80), message.get("rows", 24))
                broadcast({"t": "sessions", "list": describe()})
        elif kind == "resize" and session:
            session.resize(message.get("cols", 80), message.get("rows", 24))
        elif kind == "kill" and session:
            session.kill()
        elif kind == "title" and session:
            session.title = str(message.get("title", ""))[:60]
            broadcast({"t": "sessions", "list": describe()})
        elif kind == "write":
            write_file(str(message.get("path", "")), message.get("content", ""))
        elif kind == "ping":
            self.send({"t": "pong"})

def write_file(path, content):
    target = os.path.realpath(os.path.join(PROJECT, path))
    if not target.startswith(os.path.realpath(PROJECT) + os.sep) or not isinstance(content, str):
        return
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w") as handle:
        handle.write(content)

async def serve(reader, writer):
    try:
        request = await reader.readuntil(b"\r\n\r\n")
    except Exception:
        writer.close()
        return
    lines = request.decode("latin-1").split("\r\n")
    target = lines[0].split(" ")[1] if " " in lines[0] else "/"
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            name, value = line.split(":", 1)
            headers[name.strip().lower()] = value.strip()
    path, _, query = target.partition("?")
    if path == "/health":
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\nok")
        await writer.drain()
        writer.close()
        return
    if headers.get("upgrade", "").lower() != "websocket" or not authorised(query):
        writer.write(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        await writer.drain()
        writer.close()
        return
    accept = base64.b64encode(hashlib.sha1((headers.get("sec-websocket-key", "") + GUID).encode()).digest()).decode()
    writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n" % accept).encode())
    client = Client(reader, writer)
    CLIENTS.add(client)
    try:
        async for text in client.frames():
            try:
                client.handle(json.loads(text))
            except (ValueError, TypeError, KeyError):
                client.send({"t": "error", "message": "unreadable message"})
            await writer.drain()
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        CLIENTS.discard(client)
        writer.close()

def listening():
    found = set()
    for name in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            with open(name) as table:
                for row in table.readlines()[1:]:
                    cols = row.split()
                    if cols[3] == "0A":
                        port = int(cols[1].rsplit(":", 1)[1], 16)
                        if port != PORT and port >= 1024 and port not in (49982, 49983):
                            found.add(port)
        except OSError:
            continue
    return sorted(found)

async def watch_ports():
    global PORTS
    while True:
        await asyncio.sleep(1.5)
        now = listening()
        if now != PORTS:
            PORTS = now
            broadcast({"t": "ports", "list": PORTS})

async def main():
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    server = await asyncio.start_server(serve, "0.0.0.0", PORT, limit=1 << 22)
    asyncio.get_event_loop().create_task(watch_ports())
    async with server:
        await server.serve_forever()

asyncio.run(main())
`;
