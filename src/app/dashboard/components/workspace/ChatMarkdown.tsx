"use client";

import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/* The assistant's replies, set as a document rather than as a log line.
 *
 * Answers come back in Markdown — headings, numbered steps, bullets, bold,
 * inline code, the odd fenced block or table — and printed raw they read as a
 * machine talking: hashes and asterisks around every second word. This draws
 * them with react-markdown and GitHub-flavoured Markdown.
 *
 * No HTML is ever interpreted. There is no rehype-raw, and raw HTML in a reply
 * is turned back into the plain text it was written as (htmlAsText), so a
 * reply cannot inject markup however it is worded — and the words still show.
 *
 * Carried over from the hand-written renderer this replaced:
 *   - links only for http(s) and site paths; anything else stays as its words
 *   - "•" accepted as a bullet, as models write it
 *   - a single line break inside a paragraph is kept as a line break
 *   - headings sit below the page's own in the outline (level + 2)
 *   - whatever is passed as children (the streaming caret) sits at the end of
 *     the last line of text, not on a line of its own
 *   - an unfinished fence while streaming reads as code to the end, which
 *     CommonMark does by itself. */

type Node = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

/* Raw HTML as the text it was typed as. */
function htmlAsText() {
  return (tree: Node) => {
    const walk = (node: Node) => {
      if (!node.children) return;
      for (const child of node.children) {
        if (child.type === "html") child.type = "text";
        else walk(child);
      }
    };
    walk(tree);
  };
}

/* Models write "•" for a bullet; Markdown does not know it. Outside fences
   only, so code keeps its own characters. */
function withBullets(source: string): string {
  let fenced = false;
  return source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) fenced = !fenced;
      return fenced ? line : line.replace(/^(\s*)•\s+/, "$1- ");
    })
    .join("\n");
}

/* Where the caret goes: the deepest last element that holds text — the last
   paragraph, the last item of a closing list, the last cell. */
const CARET = "qs-caret";
const HOLDS_TEXT = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "code", "td", "th", "blockquote"]);

function caretAtEnd() {
  return (tree: Node) => {
    let target: Node | null = null;
    let node: Node | undefined = tree;
    while (node?.children) {
      const elements: Node[] = node.children.filter((child) => child.type === "element");
      const last: Node | undefined = elements[elements.length - 1];
      if (!last) break;
      if (last.tagName && HOLDS_TEXT.has(last.tagName)) target = last;
      node = last;
    }
    (target ?? tree).children?.push({ type: "element", tagName: CARET, properties: {}, children: [] });
  };
}

const SAFE_HREF = /^(?:https?:\/\/|\/)/i;

function heading(level: number) {
  const Heading = ({ children }: { children?: React.ReactNode }) => (
    <p
      role="heading"
      aria-level={Math.min(level + 2, 6)}
      className="mb-3 mt-6 text-[17px] font-semibold text-ink first:mt-0"
    >
      {children}
    </p>
  );
  Heading.displayName = `ChatHeading${level}`;
  return Heading;
}

/* The caret travels by context so the components below are made once: new
   component functions on every render would remount the whole reply on every
   streamed token, which is the flicker this must not have. */
const Caret = React.createContext<React.ReactNode>(null);

function CaretSlot() {
  return <>{React.useContext(Caret)}</>;
}

const COMPONENTS = {
  p: ({ children }) => <p className="mb-4 whitespace-pre-wrap last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  ol: ({ children, start }) => (
    <ol start={start} className="mb-4 list-decimal space-y-1.5 pl-6 marker:text-muted">
      {children}
    </ol>
  ),
  ul: ({ children }) => <ul className="mb-4 list-disc space-y-1.5 pl-6 marker:text-muted">{children}</ul>,
  /* An item's own paragraph (a list spaced out with blank lines) keeps the
     list tight rather than opening a gap under every item. */
  li: ({ children }) => <li className="pl-1 [&>p]:mb-0">{children}</li>,
  a: ({ children, href }) =>
    href && SAFE_HREF.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-sky-500 underline underline-offset-4 hover:text-sky-400">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  code: ({ children, className }) =>
    /* Inside a fence, react-markdown marks the language on the class (or the
       parent pre styles it); bare inline code is a pill. */
    className?.startsWith("language-") ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded-md border border-line/[0.1] bg-layer/[0.06] px-1.5 py-0.5 font-mono text-[13px] text-ink">
        {children}
      </code>
    ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-xl border border-line/[0.1] bg-layer/[0.06] p-4 font-mono text-[13px] leading-6 text-ink [overflow-wrap:normal] [&>code]:rounded-none [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-line/[0.15] pl-4 text-muted">{children}</blockquote>,
  hr: () => <hr className="my-6 border-line/[0.1]" />,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border-b border-line/[0.1] py-2 pr-4 text-left font-semibold text-ink">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b border-line/[0.05] py-2 pr-4">
      {children}
    </td>
  ),
  [CARET]: CaretSlot,
} as Components;

const REMARK = [remarkGfm, htmlAsText];
const WITH_CARET = [caretAtEnd];
const NO_CARET: typeof WITH_CARET = [];

export default function ChatMarkdown({ text, className = "", children }: { text: string; className?: string; children?: React.ReactNode }) {
  const source = withBullets(text);
  const hasCaret = children !== undefined && children !== null;
  return (
    <Caret.Provider value={children ?? null}>
      <div className={`min-w-0 max-w-full [overflow-wrap:anywhere] ${className}`}>
        <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={hasCaret ? WITH_CARET : NO_CARET} components={COMPONENTS}>
          {source}
        </ReactMarkdown>
      </div>
    </Caret.Provider>
  );
}
