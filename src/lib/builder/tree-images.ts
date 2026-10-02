/* Real photographs in a generated PROJECT, rather than only on a generated page.
 *
 * images.ts has filled the single-page stack's pictures since it was written:
 * the model declares a slot — an `<img data-shot="…">` carrying art direction
 * and no src — and a pass after generation puts real pixels in it. That split
 * exists because a language model cannot emit a photograph, and the module
 * beside this one argues it at length.
 *
 * The file tree never got that pass. `fillImages` is called once, on the single
 * HTML document, and a project build skips it entirely — the flag that skips it
 * is named for the SUMMARY the route writes for a tree, which genuinely has no
 * slots in it, and the tree's own files were never offered to it. So a project's
 * photographs could only ever come from the asset pipeline that runs BEFORE
 * generation and hands URLs to the model in its prompt.
 *
 * When that pipeline came back with nothing, nothing else ever ran. The model
 * was still told "the photographs for this build are listed further up",
 * found nothing listed, and did the reasonable thing: it drew a neutral panel
 * where a photograph belonged. That is the grey rounded rectangle customers
 * report as "images show as blank placeholders" — and there was no second
 * chance for it anywhere, because the safety net the single page has was never
 * strung under the tree.
 *
 * This is that net. Same slots, same provider, same rules; a tree instead of a
 * document.
 *
 * ── Why the budget is smaller here ────────────────────────────────────────
 *
 * A filled slot is a base64 data URI, which is how the single page stays
 * self-contained. A tree has a hard ceiling of its own — MAX_TREE_BYTES in
 * tree.ts, three megabytes, checked when it is stored — and a build that
 * fetches beautiful photographs and is then refused for being too large has
 * cost somebody their whole build. So the spend here is well under that, with
 * the source itself allowed for.
 */

import { type FillResult, type ImageProvider, IMAGE_BUDGET_BYTES, fillImages, tonedPanel } from "./images";
import type { PhotoId } from "./images";
import { MAX_FILE_BYTES, type FileTree } from "./tree";

/* Under MAX_TREE_BYTES with room for the project itself.
 *
 * A generated project is twenty to forty files and rarely more than 200KB of
 * source, so this leaves better than a megabyte of headroom against the three
 * the tree may occupy. Deliberately below images.ts's own budget: that one is
 * sized for a document that is nothing but the page, and this one has a project
 * to fit around. */
export const TREE_IMAGE_BUDGET_BYTES = Math.min(1_600_000, IMAGE_BUDGET_BYTES);

/* Which files can hold a slot. A slot is an `<img>` tag, so it lives wherever
   markup does — which in a Next.js project is the components and the pages. */
const RENDERS = /\.(?:tsx|jsx)$/;

export type TreeFill = {
  tree: FileTree;
  filled: number;
  skipped: number;
  bytes: number;
  credits: FillResult["credits"];
  used: PhotoId[];
};

/**
 * The tree with its declared photograph slots filled.
 *
 * Runs file by file, threading ONE exclusion set through all of them. That is
 * the part that would be wrong if each file were filled independently: within a
 * page, images.ts already stops two slots getting the same photograph, and
 * across a project the same rule has to hold or a four-page site shows the same
 * hero four times. The budget is threaded for the same reason — it is a budget
 * for the project, not for each file that happens to contain a picture.
 *
 * Never throws. A provider that is unconfigured, rate-limited or offline leaves
 * every slot with the neutral placeholder it shipped with, which is exactly
 * what images.ts guarantees for a page and is the reason photographs are a
 * deployment decision rather than a dependency.
 */
export async function fillTreeImages(
  tree: FileTree,
  provider: ImageProvider | null,
  options: {
    budget?: number;
    timeoutMs?: number;
    context?: string;
    seed?: string;
    exclude?: Iterable<PhotoId>;
    /* One deadline for every file, as Date.now() — see fillImages. */
    deadline?: number;
  } = {},
): Promise<TreeFill> {
  const credits: FillResult["credits"] = [];
  const used: PhotoId[] = [];
  const exclude = new Set<PhotoId>(options.exclude ?? []);

  let remaining = options.budget ?? TREE_IMAGE_BUDGET_BYTES;
  let filled = 0;
  let skipped = 0;
  let bytes = 0;
  let touched = false;

  const out: FileTree = [];

  for (const file of tree) {
    /* Not markup, or nothing declared in it. The second test is what keeps this
       from being a pass over every file in the project: readSlots would find
       nothing, but the work of asking is avoided for the common case. */
    if (!RENDERS.test(file.path) || !file.content.includes("data-shot")) {
      out.push(file);
      continue;
    }

    /* What this ONE file can still take.
     *
     * The budget above is the tree's, and spending it is not evenly spread:
     * the first file with slots in it is offered the whole remaining amount,
     * so a single page could be handed a megabyte of pictures. The tree stayed
     * inside its own ceiling and the file blew through project_files' per-file
     * CHECK, which readTree had cleared before any of this ran — and because
     * the tree is stored in one statement, that one file cost the project
     * every other file with it. Seen in production twice in one day: a build
     * that generated fine and reported "its files could not be stored". */
    const headroom = MAX_FILE_BYTES - Buffer.byteLength(file.content, "utf8");
    if (headroom <= 0) {
      out.push(file);
      continue;
    }

    let result: FillResult;
    try {
      result = await fillImages(file.content, provider, {
        budget: Math.min(remaining, headroom),
        timeoutMs: options.timeoutMs,
        context: options.context,
        seed: options.seed,
        exclude,
        deadline: options.deadline,
      });
    } catch {
      /* One file's fetch failing must not cost the project its other pictures,
         and must never cost it the file. */
      out.push(file);
      continue;
    }

    /* Measured rather than trusted. The budget is counted in image bytes and
       what lands in the file is text, so the two are close but not the same
       number — and "close" is not what a CHECK constraint enforces. A fill
       that would not fit is dropped and the file kept as it was: a page with
       fewer pictures is a page, where a project that will not store is
       nothing. */
    if (Buffer.byteLength(result.html, "utf8") > MAX_FILE_BYTES) {
      out.push(file);
      continue;
    }

    filled += result.filled;
    skipped += result.skipped;
    bytes += result.bytes;
    remaining = Math.max(0, remaining - result.bytes);

    for (const credit of result.credits) credits.push(credit);
    for (const id of result.used) {
      used.push(id);
      exclude.add(id);
    }

    if (result.html !== file.content) touched = true;
    out.push({ ...file, content: result.html });
  }

  /* Identity when nothing changed, so a caller can tell a fill that did work
     from one that had none to do without comparing forty files. */
  return { tree: touched ? out : tree, filled, skipped, bytes, credits, used };
}

/** Whether this tree declares any photograph slots at all. */
export function declaresPhotographs(tree: FileTree): boolean {
  return tree.some((file) => RENDERS.test(file.path) && file.content.includes("data-shot"));
}

/* ── The last resort: no <img> ships without a source ─────────────────────
 *
 * Everything above is the intended path, and the intended path can still be
 * missed. A slot whose art direction is an expression rather than a literal —
 * `<img data-shot={shot}>` inside a shared component — matches nothing in
 * images.ts, so it is not filled, and what ships is an <img> with no `src` at
 * all: a browser's broken-image icon with the alt text spilling out beside it,
 * across every card in a catalogue. That is what "Running collection" in a grey
 * rectangle was.
 *
 * The cause is fixed upstream (the generator is now told about the photographs
 * it has, and the slot rule forbids the component). This is the net under it,
 * and it exists because the failure is silent: nothing about an <img> with no
 * src is an error to a browser, a build, or a deploy.
 *
 * It prefers a real photograph. `photos` are this project's own resolved stock
 * URLs — the ones chosen for this brief's visual direction — so a repaired page
 * carries the pictures it was always meant to. Remote addresses, not inlined
 * bytes: a map of base64 would not fit in one file, and next.config.mjs already
 * allows remote images.
 *
 * Distinct art direction gets distinct photographs. A component is one tag
 * rendering many cards, so a single literal `src` would put one photograph
 * behind a whole catalogue — the clearest tell that nothing on a page is real.
 * Instead the literal `shot` values are collected from wherever the project
 * keeps them, each is given its own photograph, and the component looks itself
 * up by the value it already receives. Its call sites are not touched.
 *
 * With no photographs to hand it falls back to the toned panel every slot ships
 * with, which reads as a photograph that has not loaded rather than a mistake.
 *
 * Never throws, and never returns a tree worse than the one it was given: a
 * file it cannot edit confidently is passed through untouched.
 */

/* `>` inside an attribute would break this, and in an <img> there is nothing
   that carries one: no children, and no arrow function in the props a slot
   uses. A tag it mis-slices is a tag it then declines to edit, below. */
const IMG_TAG = /<img\b[^>]*?\/?>/gi;
const HAS_SRC = /\bsrc\s*=/;
const SHOT_EXPRESSION = /\bdata-shot\s*=\s*\{\s*([A-Za-z_$][\w$.?[\]"'-]*)\s*\}/;
const SHOT_LITERAL = /\bdata-shot\s*=\s*"([^"]*)"/;
const RATIO_LITERAL = /\bdata-ratio\s*=\s*"([^"]*)"/;
const ALT_LITERAL = /\balt\s*=\s*"([^"]*)"/;
/* Where a project keeps the art direction it feeds a component: `shot: "…"` in
   a data array, or `shot="…"` passed at a call site. */
const SHOT_VALUES = /\bshot\s*[:=]\s*"([^"]{2,240})"/g;
const ALT_VALUES = /\balt\s*:\s*"([^"]{2,240})"/g;
const MAP_CONST = "__qsShots";
const MAX_MAPPED_SHOTS = 48;

export type SourceSweep = {
  tree: FileTree;
  /** How many tags were given a source they did not have. */
  repaired: number;
  /** Files that still contain an <img> with no source. Always empty in practice. */
  unrepaired: string[];
};

export function ensureImageSources(tree: FileTree, photos: string[] = []): SourceSweep {
  const usable = photos.filter((url) => typeof url === "string" && /^https?:\/\//.test(url));

  /* Every distinct piece of art direction the project names, in the order it
     names it, so the same tree always gets the same photograph in the same
     card. A rebuild that reshuffles the photography is its own bug. */
  const shots: string[] = [];
  for (const file of tree) {
    for (const match of file.content.matchAll(SHOT_VALUES)) {
      const value = match[1].trim();
      if (value && !shots.includes(value) && shots.length < MAX_MAPPED_SHOTS) shots.push(value);
    }
  }

  const sourceForShot = new Map<string, string>();
  shots.forEach((shot, index) => {
    sourceForShot.set(shot, usable.length > 0 ? usable[index % usable.length] : tonedPanel(shot, "4/5"));
  });

  let repaired = 0;
  let plain = 0;
  const unrepaired: string[] = [];
  const out: FileTree = [];

  for (const file of tree) {
    if (!RENDERS.test(file.path) || !file.content.includes("<img")) {
      out.push(file);
      continue;
    }

    let needsMap = false;
    let changed = false;

    const next = file.content.replace(IMG_TAG, (tag) => {
      if (HAS_SRC.test(tag)) return tag;

      const ratio = RATIO_LITERAL.exec(tag)?.[1] ?? "4/3";
      const alt = ALT_LITERAL.exec(tag)?.[1] ?? "";
      const expression = SHOT_EXPRESSION.exec(tag)?.[1];

      /* The component case. It is handed the art direction at runtime, so the
         tag is given a lookup rather than an address, and every card keeps the
         photograph that belongs to it. */
      if (expression && sourceForShot.size > 0) {
        needsMap = true;
        changed = true;
        repaired += 1;
        const fallback = usable.length > 0 ? usable[0] : tonedPanel(alt || "slot", ratio);
        return tag.replace(
          /<img\b/i,
          `<img src={${MAP_CONST}[${expression}] ?? ${JSON.stringify(fallback)}}`,
        );
      }

      const literal = SHOT_LITERAL.exec(tag)?.[1] ?? "";
      const source =
        usable.length > 0
          ? usable[plain++ % usable.length]
          : tonedPanel(`${literal}${alt}`, ratio);
      changed = true;
      repaired += 1;
      return tag.replace(/<img\b/i, `<img src=${JSON.stringify(source)}`);
    });

    if (!changed) {
      out.push(file);
      continue;
    }

    const body = needsMap ? withShotMap(next, sourceForShot) : next;

    /* project_files carries a per-file CHECK, and a file that blows it takes
       every other file in the tree with it — the whole tree is stored in one
       statement. A repair is never worth that, so an oversized result is
       dropped and the tag keeps the state it had. */
    if (Buffer.byteLength(body, "utf8") > MAX_FILE_BYTES) {
      out.push(file);
      unrepaired.push(file.path);
      continue;
    }

    out.push({ ...file, content: body });
  }

  return { tree: out, repaired, unrepaired };
}

/* The lookup, declared after the imports so it is in scope for the component
   below it and cannot land between a decorator and what it decorates. */
function withShotMap(source: string, sources: Map<string, string>): string {
  if (source.includes(`const ${MAP_CONST}`)) return source;

  const entries = [...sources.entries()]
    .map(([shot, url]) => `  ${JSON.stringify(shot)}: ${JSON.stringify(url)},`)
    .join("\n");
  const declaration = `\nconst ${MAP_CONST}: Record<string, string> = {\n${entries}\n};\n`;

  const lines = source.split("\n");
  let insertAt = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(?:import|"use client"|'use client')/.test(lines[index])) insertAt = index + 1;
  }

  lines.splice(insertAt, 0, declaration);
  return lines.join("\n");
}

/* ── Placeholders are not final ───────────────────────────────────────────
 *
 * ensureImageSources gives a tag with no source the toned panel when it has no
 * photograph to hand — and from then on the tag HAS a source, so nothing ever
 * looked at it again. A project whose first build found no photographs kept
 * its grey panels forever, and "add images to the featured properties" edited
 * the markup and came back with the same panels: the edit reused this
 * project's photographs, and it had none.
 *
 * This finds every placeholder a project carries — in a component's lookup
 * map, in a literal src, in a lookup's fallback — and asks the provider for a
 * photograph matching the art direction that placeholder stands in for. Remote
 * addresses rather than inlined bytes, as the sweep above explains: they cost
 * the tree nothing, and generated projects render plain <img>.
 *
 * Never throws, never makes a file worse: a shot with no photograph keeps its
 * panel, and the tree is returned as it was for anything it cannot edit.
 */

/* A toned panel, by what tonedPanel writes: a base64 SVG of one gradient rect. */
export function isPlaceholder(src: string): boolean {
  if (!src.startsWith("data:image/svg+xml;base64,")) return false;
  try {
    const svg = Buffer.from(src.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8");
    return svg.includes('<linearGradient id="g"') && svg.includes("<rect");
  } catch {
    return false;
  }
}

const PLACEHOLDER_LITERAL = /"(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)"/g;
const MAP_BLOCK = new RegExp(`const ${MAP_CONST}(?::[^=]+)?=\\s*\\{([\\s\\S]*?)\\n\\};`);
const MAP_ENTRY = /^\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/;

/** Whether any file in the tree still shows a placeholder where a photograph belongs. */
export function hasPlaceholders(tree: FileTree): boolean {
  return tree.some(
    (file) =>
      RENDERS.test(file.path) &&
      [...file.content.matchAll(PLACEHOLDER_LITERAL)].some((match) => isPlaceholder(match[1])),
  );
}

export type Upgrade = {
  tree: FileTree;
  /** Placeholders replaced by a photograph. */
  upgraded: number;
  /** Placeholders left, because no photograph was found in time. */
  left: number;
  used: PhotoId[];
};

export async function upgradePlaceholders(
  tree: FileTree,
  provider: ImageProvider | null,
  options: { context?: string; seed?: string; exclude?: Iterable<PhotoId>; timeoutMs?: number; maxShots?: number } = {},
): Promise<Upgrade> {
  const empty = { tree, upgraded: 0, left: 0, used: [] as PhotoId[] };
  if (!provider?.locate || !hasPlaceholders(tree)) return empty;

  /* What each placeholder stands for. Three places a placeholder can be, and
     each names its art direction differently. */
  const wanted = new Map<string, string>(); // shot → ratio
  const want = (shot: string, ratio = "4/3") => {
    const key = shot.trim();
    if (key && !wanted.has(key) && wanted.size < (options.maxShots ?? MAX_MAPPED_SHOTS)) wanted.set(key, ratio);
  };

  for (const file of tree) {
    if (!RENDERS.test(file.path)) continue;

    /* The component lookup: entries still pointing at a panel. */
    const block = MAP_BLOCK.exec(file.content)?.[1];
    if (block) {
      for (const line of block.split("\n")) {
        const entry = MAP_ENTRY.exec(line);
        if (entry && isPlaceholder(JSON.parse(entry[2]))) want(JSON.parse(entry[1]));
      }
    }

    /* A literal slot whose src is a panel. */
    for (const tag of file.content.match(IMG_TAG) ?? []) {
      const src = /\bsrc\s*=\s*"([^"]*)"/.exec(tag)?.[1];
      const shot = SHOT_LITERAL.exec(tag)?.[1] ?? ALT_LITERAL.exec(tag)?.[1];
      if (src && isPlaceholder(src) && shot) want(shot, RATIO_LITERAL.exec(tag)?.[1] ?? "4/3");
    }
  }

  /* A lookup keyed on `.alt` rather than `.shot` — a hero that looks itself up
     by its description — needs the alt texts in the map too. */
  const byAlt = tree.some((file) => new RegExp(`${MAP_CONST}\\[[^\\]]*\\.alt\\]`).test(file.content));
  const keys = byAlt ? [SHOT_VALUES, ALT_VALUES] : [SHOT_VALUES];

  /* And every shot the project names but its lookup is missing — a card added
     by an edit after the map was written. */
  for (const file of tree) {
    for (const match of keys.flatMap((pattern) => [...file.content.matchAll(pattern)])) {
      const shot = match[1].trim();
      const mapped = tree.some((f) => f.content.includes(`${JSON.stringify(shot)}: "http`));
      if (!mapped) want(shot);
    }
  }

  const deadline = Date.now() + (options.timeoutMs ?? 12_000);
  const exclude = new Set<PhotoId>(options.exclude ?? []);
  const used: PhotoId[] = [];
  const found = new Map<string, string>();

  /* A few at a time: fast enough to finish inside an edit, gentle enough on a
     rate-limited search API. */
  const queue = [...wanted.entries()];
  while (queue.length > 0 && Date.now() < deadline) {
    const batch = queue.splice(0, 4);
    const results = await Promise.all(
      batch.map(async ([shot, ratio]) => {
        try {
          const located = await provider.locate!(
            { tag: "", shot, alt: shot, ratio, weight: "feature", focal: "", fit: "cover" },
            WIDTH_FOR_PROJECT,
            options.context,
            { exclude, seed: options.seed },
          );
          return located ? ([shot, located] as const) : null;
        } catch {
          return null;
        }
      }),
    );
    for (const result of results) {
      if (!result) continue;
      const [shot, located] = result;
      if (exclude.has(located.id)) continue;
      exclude.add(located.id);
      used.push(located.id);
      found.set(shot, located.url);
    }
  }

  if (found.size === 0) return { ...empty, left: wanted.size };

  let upgraded = 0;
  const firstPhoto = [...found.values()][0];
  const out: FileTree = tree.map((file) => {
    if (!RENDERS.test(file.path)) return file;
    let content = file.content;

    /* The lookup map, rewritten whole: panels replaced, missing shots added,
       real photographs already in it kept exactly as they were. */
    const match = MAP_BLOCK.exec(content);
    if (match) {
      const entries = new Map<string, string>();
      for (const line of match[1].split("\n")) {
        const entry = MAP_ENTRY.exec(line);
        if (entry) entries.set(JSON.parse(entry[1]), JSON.parse(entry[2]));
      }
      for (const [shot, url] of found) {
        const current = entries.get(shot);
        if (current === undefined || isPlaceholder(current)) {
          entries.set(shot, url);
          upgraded += 1;
        }
      }
      const body = [...entries.entries()]
        .map(([shot, url]) => `  ${JSON.stringify(shot)}: ${JSON.stringify(url)},`)
        .join("\n");
      content = content.replace(match[0], `const ${MAP_CONST}: Record<string, string> = {\n${body}\n};`);

      /* The lookup's fallback: a card whose shot is not in the map gets a real
         photograph rather than a panel. */
      content = content.replace(
        new RegExp(`(${MAP_CONST}\\[[^\\]]+\\]\\s*\\?\\?\\s*)"(data:image\\/svg\\+xml;base64,[A-Za-z0-9+/=]+)"`, "g"),
        (whole, head: string, src: string) => (isPlaceholder(src) ? `${head}${JSON.stringify(firstPhoto)}` : whole),
      );
    }

    /* Literal slots. */
    content = content.replace(IMG_TAG, (tag) => {
      const src = /\bsrc\s*=\s*"([^"]*)"/.exec(tag)?.[1];
      if (!src || !isPlaceholder(src)) return tag;
      const shot = (SHOT_LITERAL.exec(tag)?.[1] ?? ALT_LITERAL.exec(tag)?.[1] ?? "").trim();
      const url = found.get(shot);
      if (!url) return tag;
      upgraded += 1;
      return tag.replace(/\bsrc\s*=\s*"[^"]*"/, `src=${JSON.stringify(url)}`);
    });

    if (content === file.content || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) return file;
    return { ...file, content };
  });

  return { tree: out, upgraded, left: Math.max(0, wanted.size - found.size), used };
}

/* Wide enough for a hero on a laptop, and a remote address costs nothing to
   store whatever its width. */
const WIDTH_FOR_PROJECT = 1400;

/* "Add images to the featured properties", "the photos are missing", "fix the
   grey boxes": a request about pictures, as opposed to one that happens to
   mention a picture while asking about the copy under it. */
const PICTURE_WORDS = /\b(images?|photos?|pictures?|photographs?|imagery|thumbnails?|grey boxes|gray boxes|placeholders?)\b/i;
const PICTURE_ASKS = /\b(add|missing|broken|blank|empty|grey|gray|placeholders?|fix|update|refresh|replace|real|show|load|put|attach|no)\b/i;

export function asksForImages(message: string): boolean {
  return PICTURE_WORDS.test(message) && PICTURE_ASKS.test(message);
}
