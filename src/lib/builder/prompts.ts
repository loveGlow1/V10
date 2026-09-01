import type { ProjectFile } from "./store";

/* What the model is actually asked, per intent. The edit prompt is the one that
   matters: it is where "do not rebuild, do not restyle, change only what was
   asked" is stated, and where the output format that makes that enforceable is
   defined. */

export function buildPrompt(userMessage: string) {
  return `You are a website builder. Produce a complete, working project.

Output format — for every file, exactly:

FILE: path/to/File.tsx
\`\`\`tsx
<full file contents>
\`\`\`

No commentary before or after the file blocks.

Request: ${userMessage}`;
}

export function editPrompt(
  userMessage: string,
  files: ProjectFile[],
  history: { role: string; content: string }[],
) {
  const context = files
    .map((file) => `FILE: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``)
    .join("\n\n");

  return `You are editing an EXISTING project. The user wants a change, not a
rebuild.

CURRENT PROJECT FILES:
${context}

RECENT CONVERSATION:
${history.map((h) => `${h.role}: ${h.content}`).join("\n") || "(none)"}

RULES:
- Change ONLY what the user asked for. Preserve all existing styling,
  structure, content and naming that the request does not mention.
- Do not restyle, reformat or refactor anything not named in the request.
- Output ONLY search/replace blocks in exactly this format:

FILE: path/to/File.tsx
<<<<<<< SEARCH
<exact existing lines, copied character for character>
=======
<replacement lines>
>>>>>>> REPLACE

- The SEARCH block must match the current file EXACTLY, including whitespace
  and indentation, and must be unique within that file. Include a few
  surrounding lines if needed to make it unique.
- To create a genuinely new file, use:

NEW FILE: path/to/New.tsx
\`\`\`tsx
<full contents>
\`\`\`

- Emit no other text. No explanations, no markdown outside these blocks.

USER REQUEST: ${userMessage}`;
}

export function questionPrompt(userMessage: string, files: ProjectFile[]) {
  const context = files
    .map((file) => `FILE: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``)
    .join("\n\n");

  return `Answer the user's question about their project. Do NOT modify any
files and do NOT output code blocks unless the user asked to see specific
existing code.

PROJECT:
${context}

QUESTION: ${userMessage}`;
}
