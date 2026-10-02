"use client";

import React from "react";

/* The assistant's replies, set as a conversation rather than as a log line.
 *
 * Answers come back in a small Markdown dialect — a heading, numbered steps,
 * bullets, bold, inline code, the odd fenced block — and printed raw they read
 * as a machine talking: hashes and asterisks around every second word. This
 * draws that dialect and nothing more. No HTML is ever interpreted: every piece
 * of text ends up as a React text node, so a reply cannot inject markup however
 * it is worded. Anything this does not recognise stays as the words it was. */

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "code"; text: string };

const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const FENCE = /^\s*```/;

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = !bullet;
      const last = blocks[blocks.length - 1];
      const text = bullet ? bullet[1] : numbered![2];
      /* A blank line between items is still one list: models space them out. */
      if (last && last.kind === "list" && last.ordered === ordered) last.items.push(text);
      else blocks.push({ kind: "list", ordered, start: numbered ? Number(numbered[1]) : 1, items: [text] });
      continue;
    }

    /* An indented line straight after an item continues it. */
    const last = blocks[blocks.length - 1];
    if (!paragraph.length && last && last.kind === "list" && /^\s{2,}\S/.test(line)) {
      last.items[last.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    paragraph.push(line);
  }
  flush();
  return blocks;
}

/* Bold, italic, inline code and links inside one run of text. */
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g;

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let at = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > at) out.push(text.slice(at, index));
    const key = `${keyBase}-${n++}`;
    if (token.startsWith("`")) {
      out.push(
        <code key={key} className="rounded-md border border-line/[0.1] bg-layer/[0.06] px-1.5 py-[1px] font-mono text-[0.88em] text-ink">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      out.push(
        <strong key={key} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("[")) {
      const close = token.indexOf("](");
      const href = token.slice(close + 2, -1);
      out.push(
        <a key={key} href={href} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
          {token.slice(1, close)}
        </a>,
      );
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    at = index + token.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export default function ChatMarkdown({ text, className = "", children }: { text: string; className?: string; children?: React.ReactNode }) {
  const blocks = parse(text);
  return (
    <div className={`space-y-3 text-[15px] leading-[1.65] text-soft md:text-[13.5px] ${className}`}>
      {blocks.map((block, b) => {
        const key = `b${b}`;
        /* Whatever follows the text (the streaming caret) sits on its last line. */
        const tail = b === blocks.length - 1 ? children : null;
        if (block.kind === "heading") {
          const size = block.level <= 1 ? "text-[21px] md:text-[17px]" : block.level === 2 ? "text-[19px] md:text-[15.5px]" : "text-[16.5px] md:text-[14px]";
          return (
            <p key={key} role="heading" aria-level={Math.min(block.level + 2, 6)} className={`pt-1 font-semibold leading-snug tracking-tight text-ink ${size}`}>
              {inline(block.text, key)}
              {tail}
            </p>
          );
        }
        if (block.kind === "code") {
          return (
            <pre key={key} className="overflow-x-auto rounded-xl border border-line/[0.08] bg-layer/[0.05] px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink md:text-[12px]">
              {block.text}
              {tail}
            </pre>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List
              key={key}
              start={block.ordered && block.start !== 1 ? block.start : undefined}
              className={`space-y-1.5 pl-6 ${block.ordered ? "list-decimal marker:text-muted" : "list-disc marker:text-muted"}`}
            >
              {block.items.map((item, i) => (
                <li key={`${key}-${i}`} className="pl-1">
                  {inline(item, `${key}-${i}`)}
                  {i === block.items.length - 1 ? tail : null}
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={key} className="whitespace-pre-wrap">
            {inline(block.text, key)}
            {tail}
          </p>
        );
      })}
      {blocks.length === 0 && children}
    </div>
  );
}
