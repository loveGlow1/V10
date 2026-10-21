"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* The agent's words, as prose: Markdown rendered, never shown raw — no stray
   `**` or fences in the thread. Sans-serif at a reading measure; code spans
   and blocks are the only monospace, and a block scrolls inside itself rather
   than widening the page. */
export default function TextPart({ text }: { text: string }) {
  return (
    <div className="max-w-prose min-w-0 break-words text-[15px] leading-7 text-zinc-800 dark:text-zinc-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-zinc-950 dark:text-white">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="underline decoration-zinc-400 underline-offset-2 hover:decoration-current">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-zinc-400">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-zinc-400">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          h1: ({ children }) => <h3 className="mb-2 mt-4 text-[17px] font-semibold text-zinc-950 dark:text-white">{children}</h3>,
          h2: ({ children }) => <h3 className="mb-2 mt-4 text-[16px] font-semibold text-zinc-950 dark:text-white">{children}</h3>,
          h3: ({ children }) => <h4 className="mb-1.5 mt-3 text-[15px] font-semibold text-zinc-950 dark:text-white">{children}</h4>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-zinc-300 pl-3 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">{children}</blockquote>
          ),
          hr: () => <hr className="my-4 border-zinc-200 dark:border-zinc-800" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-left text-[14px]">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-zinc-200 px-2 py-1 font-semibold dark:border-zinc-800">{children}</th>,
          td: ({ children }) => <td className="border-b border-zinc-100 px-2 py-1 dark:border-zinc-900">{children}</td>,
          pre: ({ children }) => (
            <pre className="my-3 max-w-full overflow-x-auto rounded-lg bg-zinc-950 p-3 text-[13px] leading-6 text-zinc-100 dark:bg-black">
              {children}
            </pre>
          ),
          code: ({ children, className }) =>
            /* A block's code sits in the <pre> above; an inline span gets a chip. */
            className ? (
              <code className={`${className} font-mono`}>{children}</code>
            ) : (
              <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[13px] text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                {children}
              </code>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
