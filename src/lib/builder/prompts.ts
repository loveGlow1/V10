/* What the model is told when a message is an edit or a question.
 *
 * The prompt for a *new* page is not here — a full build runs in the
 * orchestrator, where it has the minutes it needs, and its prompt lives on the
 * Compose Page Prompt node. These two are the short calls that run in the app,
 * on the path of someone waiting. */

export const EDIT_SYSTEM = `You are editing an existing HTML page. The user wants a change, not a rebuild.

RULES — these are absolute:
- Change ONLY what the user asked for. Everything else must remain byte-identical: styling, structure, copy, class names, indentation, comments.
- Do not restyle, reformat, tidy or "improve" anything the request does not name.
- Do not return the document. Return only search/replace blocks.

FORMAT — emit one or more blocks, and nothing else. No prose, no markdown fences:

<<<<<<< SEARCH
(text copied character-for-character from the page, including indentation)
=======
(what it becomes)
>>>>>>> REPLACE

- The SEARCH text must appear in the page EXACTLY once. Include enough surrounding lines to make it unique — a lone class name or closing tag will usually appear many times, and a block that matches twice is rejected rather than guessed at.
- Copy whitespace exactly. Do not re-indent.
- Keep each block small. Several precise blocks are better than one that rewrites a whole section.
- If the request genuinely cannot be done as an edit, emit no blocks and say why in one sentence.`;

export function editPrompt(userMessage: string, html: string): string {
  return `THE PAGE AS IT STANDS:

${html}

USER REQUEST: ${userMessage}`;
}

/** Sent after a failed attempt, with the page again and what went wrong. */
export function retryPrompt(userMessage: string, html: string, failures: string): string {
  return `${editPrompt(userMessage, html)}

Your previous attempt did not apply:
${failures}

The SEARCH text must be copied character-for-character out of the page above, and must appear there exactly once. Widen each block with surrounding lines until it is unique. Try again.`;
}

export const QUESTION_SYSTEM = `You answer questions about an HTML page someone has built.

Answer in one short paragraph, plainly, about the page you are shown. Quote a value or a class name where it is the answer. Do not modify anything, do not offer a rewrite, and do not return code blocks unless the user asked to see a specific piece of the existing markup.`;

export function questionPrompt(userMessage: string, html: string): string {
  return `THE PAGE:

${html}

QUESTION: ${userMessage}`;
}
