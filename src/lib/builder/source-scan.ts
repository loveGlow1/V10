/* Finding where something ends, in source nobody parsed.
 *
 * Two files now need to take one declaration out of a generated module and
 * leave the rest intact: client-routes.ts, which lifts generateStaticParams out
 * of a page that may not hold it, and next-structure.ts, which moves a
 * component out of a page module that may not export it. Both need the same
 * thing — where does this function's body close — and neither can afford the
 * duplicate, because a scanner that is subtly wrong in one copy is a rewrite
 * that silently truncates somebody's file.
 *
 * WHY NOT A PARSER, here as everywhere else in this codebase: pages are written
 * by models and hand-edited by people, and a strict parse refuses working files
 * over a stray attribute. This does not need to understand the code. It needs
 * to not be fooled by a brace inside a string, a comment, a regex or a template
 * literal, which is all generated React actually contains.
 */

/**
 * The index just past the closing brace of the first block at or after `from`,
 * or -1 when there is no balanced block there.
 *
 * Returns -1 rather than guessing on anything it cannot follow. Every caller
 * treats that as "leave this file alone", which is the only safe answer: a
 * repair that guesses where a function ends is worse than the framework's own
 * error message.
 */
export function blockAfter(source: string, from: number): number {
  const open = source.indexOf("{", from);
  if (open === -1) return -1;

  let depth = 0;
  let quote: string | null = null;
  let line = false;
  let block = false;

  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (line) {
      if (ch === "\n") line = false;
      continue;
    }
    if (block) {
      if (ch === "*" && next === "/") { block = false; i += 1; }
      continue;
    }
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { line = true; i += 1; continue; }
    if (ch === "/" && next === "*") { block = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }

    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }

  return -1;
}

/**
 * The index just past the end of a `const Name = ...;` declaration.
 *
 * The other shape a generated component comes in, and it does not end at a
 * brace: `const Card = () => (<div/>);` closes on a paren, and
 * `const Card = styled.div\`…\`` on a backtick. So this walks to the semicolon
 * or newline that ends the statement at depth zero, skipping the same things
 * blockAfter skips.
 */
export function statementAfter(source: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  let line = false;
  let block = false;

  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (line) {
      if (ch === "\n") line = false;
      continue;
    }
    if (block) {
      if (ch === "*" && next === "/") { block = false; i += 1; }
      continue;
    }
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { line = true; i += 1; continue; }
    if (ch === "/" && next === "*") { block = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }

    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    else if (ch === ";" && depth === 0) return i + 1;
    else if (ch === "\n" && depth === 0) {
      /* A statement that ended without a semicolon. Only believed when what
         follows starts something new, so a declaration broken across lines is
         not cut in half. */
      const rest = source.slice(i + 1);
      if (/^\s*(?:export\b|const\b|let\b|var\b|function\b|class\b|async\s+function\b|\/\/|\/\*|$)/.test(rest)) {
        return i + 1;
      }
    }
  }

  return source.length;
}
