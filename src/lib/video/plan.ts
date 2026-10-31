/* The production plan — what the Creative Director produces and every later
 * stage reads — plus the parts of the orchestrator that need no network:
 * reading a plan the model wrote, routing each scene to an engine, and the
 * plan-level QA and automatic repair (Step 6, before a frame is rendered).
 *
 * Pure. The model call is in director.ts; the engines are in engines.ts. */

import { PIPELINES, type Engine, type PipelineId } from "./pipelines";

export type Scene = {
  n: number;
  /** Seconds. */
  duration: number;
  /** Shot type and camera move, e.g. "close-up, slow dolly in". */
  shot: string;
  /** What is on screen. */
  visual: string;
  /** Text burned into the frame, or "". */
  onScreenText: string;
  /** The spoken line, or "". Dialogue is "NAME: line". */
  voiceover: string;
  /** The prompt the generation engine receives. */
  motionPrompt: string;
  /** Music and sound for this scene. */
  sound: string;
  engine: Engine;
};

/* How the final cut is put together — what a person changes by asking
   ("use the original voices", "no captions", "end on QuickStark.ai") without
   anything being generated again. Absent means the defaults. */
export type Cut = {
  /** voiceover: only the script's voice. original: only the clips' own sound. mix: both. */
  audio?: "voiceover" | "original" | "mix";
  /** Captions of each spoken line, burned in. Default on. */
  captions?: boolean;
  /** Words on the last scene, e.g. "QuickStark.ai". */
  endCard?: string;
  /** Scenes whose own sound is silenced. */
  muted?: number[];
};

export type ProductionPlan = {
  pipeline: PipelineId;
  title: string;
  /** The Creative Director's one-paragraph concept. */
  concept: string;
  /** Strategy: insight, promise, audience. Mostly used by ads. */
  strategy: string;
  aspect: "9:16" | "1:1" | "16:9" | "4:5";
  /** Target length in seconds. */
  target: number;
  voice: string;
  music: string;
  /** Alternative opening hooks, when asked for. */
  hooks: string[];
  /** Consistency that must hold in every scene — product, characters, style. */
  locks: Record<string, string>;
  scenes: Scene[];
  cta: string;
  cut?: Cut;
};

export type QaIssue = { scene: number | null; issue: string; repaired: boolean };

/* QuickStark's own name is always said and shown in full: "QuickStark.ai",
   never a bare "QuickStark". Pure. */
export const BRAND = "QuickStark.ai";
export function withBrand(text: string): string {
  return text.replace(/\bQuick ?Stark(?:\.ai\b|\.Ai\b|\.AI\b)?(?!\.\w)/gi, BRAND);
}

/* The longest clip one generation makes: a 4s MiniMax-H3 clip took ~126s
   against the n8n instance's 180s run limit (render.ts). A scene longer than
   this would freeze on its last frame, so QA splits it into clips that fit. */
export const MAX_CLIP_SECONDS = 6;

/* A brief written from a template still carrying "[PRODUCT]" or "[CTA]" —
   planned as is, the video would say "[PRODUCT]" out loud. */
export function unfilledPlaceholders(brief: string): string[] {
  const found = brief.match(/\[[A-Z][A-Z0-9 /&'-]{1,40}\]/g) ?? [];
  return [...new Set(found)];
}

/* A spoken line cut into `parts` pieces at sentence ends where it has them,
   else at the word nearest an even split — so each clip carries the words
   that fit its seconds. */
function splitLine(line: string, parts: number): string[] {
  if (!line || parts < 2) return [line, ...Array(Math.max(0, parts - 1)).fill("")];
  const sentences = line.match(/[^.!?]+[.!?]+["”']?|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [line];
  const units = sentences.length >= parts ? sentences : line.split(/\s+/);
  const total = units.reduce((sum, unit) => sum + unit.split(/\s+/).length, 0);
  const out: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const unit of units) {
    const count = unit.split(/\s+/).length;
    /* Cut before this unit when that lands nearer the even share than after it. */
    const share = (total * (out.length + 1)) / parts;
    if (current.length && out.length < parts - 1 && Math.abs(words - share) <= Math.abs(words + count - share)) {
      out.push(current.join(" "));
      current = [];
    }
    current.push(unit);
    words += count;
  }
  out.push(current.join(" "));
  while (out.length < parts) out.push("");
  return out;
}

/** One scene as clips no longer than MAX_CLIP_SECONDS, its line shared across them in order. */
export function splitScene(scene: Scene, max = MAX_CLIP_SECONDS): Scene[] {
  if (scene.duration <= max) return [scene];
  const parts = Math.ceil(scene.duration / max);
  const base = Math.floor(scene.duration / parts);
  const lines = splitLine(scene.voiceover, parts);
  return Array.from({ length: parts }, (_, i) => ({
    ...scene,
    duration: base + (i < scene.duration - base * parts ? 1 : 0),
    voiceover: lines[i],
    /* A title card is shown once, on the first shot. */
    onScreenText: i === 0 ? scene.onScreenText : "",
    motionPrompt: i === 0 ? scene.motionPrompt : `${scene.motionPrompt} Continuation of the previous shot: same subject, setting, framing and light, the action carrying on.`,
  }));
}

const ASPECTS = ["9:16", "1:1", "16:9", "4:5"] as const;

/** "Vertical 9:16" → "9:16"; "30s" → 30; "2 min" → 120. */
export function aspectFrom(answer: string | undefined): ProductionPlan["aspect"] {
  const found = ASPECTS.find((ratio) => answer?.includes(ratio));
  return found ?? "16:9";
}

export function secondsFrom(answer: string | undefined): number {
  if (!answer) return 30;
  const min = answer.match(/(\d+(?:\.\d+)?)\s*min/i);
  if (min) return Math.round(Number(min[1]) * 60);
  const sec = answer.match(/(\d+)\s*s/i);
  return sec ? Number(sec[1]) : 30;
}

const text = (value: unknown, max = 1200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/* The generation router. The director's choice is taken when the pipeline
   allows it; otherwise, a scene with a person speaking to camera goes to the
   avatar engine where the pipeline has one, and everything else to the
   pipeline's default. */
export function routeScene(pipeline: PipelineId, asked: unknown, scene: Pick<Scene, "visual" | "voiceover" | "shot">): Engine {
  const spec = PIPELINES[pipeline];
  if (typeof asked === "string" && (spec.engines as string[]).includes(asked)) return asked as Engine;
  const speaking = /\b(talks?|speaks?|says|to camera|presenter|creator|talking head|selfie)\b/i.test(`${scene.visual} ${scene.shot}`) && Boolean(scene.voiceover);
  if (speaking && spec.engines.includes("avatar")) return "avatar";
  return spec.defaultEngine;
}

/** Reads what the model wrote into a plan, whatever it left out. Never throws. */
export function normalizePlan(raw: unknown, pipeline: PipelineId, answers: Record<string, string>): ProductionPlan {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawScenes = Array.isArray(r.scenes) ? r.scenes.slice(0, 24) : [];
  const scenes: Scene[] = rawScenes.map((entry, index) => {
    const s = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const base = {
      n: index + 1,
      duration: Math.min(30, Math.max(1, Math.round(Number(s.duration) || 3))),
      shot: text(s.shot, 200),
      visual: text(s.visual),
      onScreenText: text(s.onScreenText, 200),
      voiceover: text(s.voiceover, 600),
      motionPrompt: text(s.motionPrompt),
      sound: text(s.sound, 300),
    };
    return { ...base, engine: routeScene(pipeline, s.engine, base) };
  });
  const locks: Record<string, string> = {};
  if (r.locks && typeof r.locks === "object") {
    for (const [key, value] of Object.entries(r.locks as Record<string, unknown>).slice(0, 8)) {
      const v = text(value, 800);
      if (v) locks[key.replace(/[^\w ]/g, "").slice(0, 40)] = v;
    }
  }
  return {
    pipeline,
    title: text(r.title, 120) || PIPELINES[pipeline].label,
    concept: text(r.concept, 1500),
    strategy: text(r.strategy, 1500),
    aspect: (ASPECTS as readonly string[]).includes(String(r.aspect)) ? (r.aspect as ProductionPlan["aspect"]) : aspectFrom(answers.aspect ?? answers.format),
    target: secondsFrom(answers.length) || 30,
    voice: text(r.voice, 300),
    music: text(r.music, 300),
    hooks: Array.isArray(r.hooks) ? r.hooks.map((hook) => text(hook, 300)).filter(Boolean).slice(0, 5) : [],
    locks,
    scenes,
    cta: text(r.cta, 300),
    ...(normalizeCut(r.cut) ? { cut: normalizeCut(r.cut) } : {}),
  };
}

/** A cut as written by a person or the editor, with anything unknown dropped. Pure. */
export function normalizeCut(raw: unknown): Cut | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const cut: Cut = {};
  if (r.audio === "voiceover" || r.audio === "original" || r.audio === "mix") cut.audio = r.audio;
  if (typeof r.captions === "boolean") cut.captions = r.captions;
  const end = text(r.endCard, 80);
  if (end) cut.endCard = end;
  if (Array.isArray(r.muted)) {
    const muted = r.muted.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 24);
    if (muted.length) cut.muted = [...new Set(muted)];
  }
  return Object.keys(cut).length ? cut : undefined;
}

export const totalSeconds = (plan: ProductionPlan) => plan.scenes.reduce((sum, scene) => sum + scene.duration, 0);

/* Step 6, on the plan. Checks what can be checked before anything is
   rendered, and repairs what has one right answer. What is left unrepaired is
   reported, never hidden. */
export function qaAndRepair(input: ProductionPlan): { plan: ProductionPlan; issues: QaIssue[] } {
  const plan: ProductionPlan = { ...input, scenes: input.scenes.map((scene) => ({ ...scene })), locks: { ...input.locks } };
  const issues: QaIssue[] = [];
  const spec = PIPELINES[plan.pipeline];

  if (plan.scenes.length === 0) {
    issues.push({ scene: null, issue: "The plan has no scenes.", repaired: false });
    return { plan, issues };
  }

  /* Length: scale the scene durations to the target when they miss it by
     more than 15%, keeping each at least a second. */
  const total = totalSeconds(plan);
  if (plan.target > 0 && Math.abs(total - plan.target) / plan.target > 0.15) {
    const factor = plan.target / total;
    for (const scene of plan.scenes) scene.duration = Math.max(1, Math.round(scene.duration * factor));
    issues.push({ scene: null, issue: `Scenes ran ${total}s against a ${plan.target}s target — durations rescaled to ${totalSeconds(plan)}s.`, repaired: true });
  }

  /* One clip per scene, each short enough to be made in one go. A clone's
     presenter scene is made from the person's own photo and voice instead,
     at any length, so it stays whole. */
  const before = plan.scenes.length;
  plan.scenes = plan.scenes
    .flatMap((scene) => (plan.pipeline === "clone" && scene.engine === "avatar" ? [scene] : splitScene(scene)))
    .map((scene, index) => ({ ...scene, n: index + 1 }));
  if (plan.scenes.length > before) {
    issues.push({ scene: null, issue: `Scenes longer than ${MAX_CLIP_SECONDS}s split into ${plan.scenes.length - before} more clip${plan.scenes.length - before === 1 ? "" : "s"}, so none freezes on its last frame.`, repaired: true });
  }

  for (const scene of plan.scenes) {
    if (!scene.motionPrompt) {
      scene.motionPrompt = [scene.shot, scene.visual].filter(Boolean).join(". ");
      if (scene.motionPrompt) issues.push({ scene: scene.n, issue: "Missing generation prompt — built from the shot and visual.", repaired: true });
      else issues.push({ scene: scene.n, issue: "Scene has no visual description.", repaired: false });
    }
    if (scene.engine === "avatar" && !scene.voiceover) {
      scene.engine = spec.engines.includes("video") ? "video" : spec.defaultEngine;
      issues.push({ scene: scene.n, issue: "Avatar scene with no line to speak — routed to the video engine.", repaired: true });
    }
  }

  /* Consistency locks: a locked description is appended to every prompt that
     does not already carry it, so the engines receive it scene by scene. */
  for (const [name, lock] of Object.entries(plan.locks)) {
    const anchor = lock.slice(0, 40).toLowerCase();
    let added = 0;
    for (const scene of plan.scenes) {
      if (!scene.motionPrompt.toLowerCase().includes(anchor)) {
        scene.motionPrompt = `${scene.motionPrompt} [${name}: ${lock}]`;
        added += 1;
      }
    }
    if (added) issues.push({ scene: null, issue: `${name} lock added to ${added} scene prompt${added === 1 ? "" : "s"} so it stays consistent.`, repaired: true });
  }
  if (spec.needsReference === "product" && !Object.keys(plan.locks).some((key) => /product/i.test(key))) {
    issues.push({ scene: null, issue: "No product lock — upload a product image or describe the product so it stays identical in every scene.", repaired: false });
  }

  /* The brand, in full, wherever it is said or shown. */
  let branded = 0;
  for (const scene of plan.scenes) {
    for (const key of ["voiceover", "onScreenText"] as const) {
      const fixed = withBrand(scene[key]);
      if (fixed !== scene[key]) {
        scene[key] = fixed;
        branded += 1;
      }
    }
  }
  if (plan.cta) plan.cta = withBrand(plan.cta);
  if (plan.cut?.endCard) plan.cut = { ...plan.cut, endCard: withBrand(plan.cut.endCard) };
  if (plan.title) plan.title = withBrand(plan.title);
  if (branded) issues.push({ scene: null, issue: `The name is said and shown as ${BRAND} throughout.`, repaired: true });

  /* Ads and social end on the call to action. */
  if (["commercial_ad", "ugc_influencer", "social_video", "product_showcase"].includes(plan.pipeline) && plan.cta) {
    const last = plan.scenes[plan.scenes.length - 1];
    if (!`${last.onScreenText} ${last.voiceover}`.toLowerCase().includes(plan.cta.toLowerCase().slice(0, 20))) {
      last.onScreenText = last.onScreenText ? `${last.onScreenText} · ${plan.cta}` : plan.cta;
      issues.push({ scene: last.n, issue: "Last scene did not carry the CTA — added to its on-screen text.", repaired: true });
    }
  }

  /* UGC is AI-made and an ad; the final frame says so. */
  if (plan.pipeline === "ugc_influencer") {
    const last = plan.scenes[plan.scenes.length - 1];
    if (!/ai-generated/i.test(last.onScreenText)) {
      last.onScreenText = `${last.onScreenText}${last.onScreenText ? " · " : ""}AI-generated · Ad`;
      issues.push({ scene: last.n, issue: "Disclosure added to the final frame.", repaired: true });
    }
  }

  return { plan, issues };
}

/** The plan as a plain-text production script — what Export gives you before any engine is connected. */
export function scriptText(plan: ProductionPlan): string {
  const lines = [
    plan.title.toUpperCase(),
    `${PIPELINES[plan.pipeline].label} · ${plan.aspect} · ${totalSeconds(plan)}s`,
    "",
    plan.concept && `CONCEPT\n${plan.concept}\n`,
    plan.strategy && `STRATEGY\n${plan.strategy}\n`,
    Object.keys(plan.locks).length ? `LOCKS\n${Object.entries(plan.locks).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n` : "",
    plan.hooks.length ? `HOOKS\n${plan.hooks.map((h, i) => `${i + 1}. ${h}`).join("\n")}\n` : "",
    `VOICE: ${plan.voice || "—"}\nMUSIC: ${plan.music || "—"}\n`,
    ...plan.scenes.map(
      (s) =>
        `SCENE ${s.n} · ${s.duration}s · ${s.engine.toUpperCase()}\nShot: ${s.shot}\nVisual: ${s.visual}\nOn screen: ${s.onScreenText || "—"}\nVoiceover: ${s.voiceover || "—"}\nSound: ${s.sound || "—"}\nPrompt: ${s.motionPrompt}\n`,
    ),
    plan.cta && `CTA: ${plan.cta}`,
  ];
  return lines.filter(Boolean).join("\n");
}
