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
- The three marker lines above are structural. Never put a line consisting of \`<<<<<<< SEARCH\`, \`=======\` or \`>>>>>>> REPLACE\` inside the SEARCH or REPLACE body — there is no way to escape one, so a block containing one is rejected rather than guessed at.
- If the page you are shown already contains those markers as visible text, do NOT try to remove them with a block: quoting them is what put them there. Say so in one sentence instead; they are cleaned up separately, before you are asked.
- If the request genuinely cannot be done as an edit, emit no blocks and say why in one sentence.`;

/** A turn of the workspace conversation, oldest first. */
export type Turn = { from: string; text: string };

/* What was said before this message, so that a request which points at
   something — "delete this", "that one too", "no, the other button" — has the
   thing it points at in view.
 *
 * Without it every message was read as though it were the first: "delete this
 * out" arrives with a page and no referent, and the model picks whatever looks
 * most deletable. That is the difference between a specific edit and a plausible
 * one, and it is the whole reason a person ends up repeating themselves.
 *
 * Trimmed hard, because this rides in front of the whole document on a call
 * someone is watching a cursor for. The recent turns are the ones that carry a
 * referent; an hour ago is a different subject. */
function conversation(history: Turn[]): string {
  const recent = history.slice(-6);
  if (recent.length === 0) return "";

  const lines = recent
    .map((turn) => `${turn.from === "user" ? "USER" : "ASSISTANT"}: ${turn.text.slice(0, 400)}`)
    .join("\n");

  return `WHAT WAS SAID BEFORE THIS (oldest first, for resolving what "this" and "that" refer to):

${lines}

`;
}

export function editPrompt(userMessage: string, html: string, history: Turn[] = []): string {
  return `${conversation(history)}THE PAGE AS IT STANDS:

${html}

USER REQUEST: ${userMessage}`;
}

/** Sent after a failed attempt, with the page again and what went wrong. */
export function retryPrompt(
  userMessage: string,
  html: string,
  failures: string,
  history: Turn[] = [],
): string {
  return `${editPrompt(userMessage, html, history)}

Your previous attempt did not apply:
${failures}

The SEARCH text must be copied character-for-character out of the page above, and must appear there exactly once. Widen each block with surrounding lines until it is unique. Try again.`;
}

export const QUESTION_SYSTEM = `You answer questions about an HTML page someone has built.

Answer in one short paragraph, plainly, about the page you are shown. Quote a value or a class name where it is the answer. Do not modify anything, do not offer a rewrite, and do not return code blocks unless the user asked to see a specific piece of the existing markup.`;

export function questionPrompt(userMessage: string, html: string, history: Turn[] = []): string {
  return `${conversation(history)}THE PAGE:

${html}

QUESTION: ${userMessage}`;
}
