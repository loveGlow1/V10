/* Reading a server-sent event stream.

   Pulled out of the one caller so the parsing is testable on its own and so a
   second stream later does not reimplement it. It is deliberately the smallest
   thing that works against our own routes rather than a full SSE client: no
   `event:` names, no ids, no retry — those are features nothing here sends, and
   parsing them would be code with no reader.

   The one part that is not optional is the buffering. A frame is not guaranteed
   to arrive whole: the network can split one anywhere, including mid-JSON, so
   anything after the last blank line is kept back until the rest of it turns
   up. Parsing a fragment would silently drop a phase. */

/** Calls `onFrame` with each parsed `data:` payload, until the stream ends. */
export async function readSseFrames(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((part) => part.startsWith("data:"));
      if (!line) continue;
      try {
        onFrame(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
      } catch {
        /* A frame this client cannot parse is skipped rather than thrown:
           losing one progress line is not worth failing a build that ran. */
      }
    }
  }
}
