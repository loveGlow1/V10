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
};

export type QaIssue = { scene: number | null; issue: string; repaired: boolean };

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
  };
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
