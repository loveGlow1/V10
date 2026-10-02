/* QuickStark Video Studio — the ten creative pipelines.
 *
 * Not ten systems. One orchestrator (orchestrator.ts) runs every video
 * through the same stages — Creative Director, script, storyboard, scene
 * planner, generation router, voice, music, captions, visual QA, repair,
 * render — and each pipeline here is DATA that specialises it:
 *
 *   questions   what Step 2 asks, and only that
 *   stages      the pipeline as the person sees it on the studio page
 *   director    the rules the Creative Director plans by
 *   engines     which generation engine a scene may go to by default
 *   locks       consistency that must hold across every scene
 *
 * Adding an eleventh type is an entry in this file, not a new system.
 *
 * Pure: read by the browser (the grid, the questions) and by the server (the
 * director), and compiled on its own by tools/check-video.mjs. */

export type Engine = "video" | "image" | "avatar";

export type Question = {
  id: string;
  label: string;
  options: string[];
  /** Pre-selected answer; the person can move it. */
  initial?: string;
};

export type Pipeline = {
  id: PipelineId;
  label: string;
  /** One line under the label on the grid card. */
  blurb: string;
  /** What the card's icon is called in lucide-react — mapped in the UI. */
  icon: string;
  stages: string[];
  questions: Question[];
  /** Rules the Creative Director must follow for this pipeline. */
  director: string[];
  /** The engine a scene uses unless the director has reason to choose another. */
  defaultEngine: Engine;
  /** Engines this pipeline may route to at all. */
  engines: Engine[];
  /** Asks for a reference upload (product image, photo, person). */
  needsReference?: "product" | "photo" | "person";
  /** Requires the person to confirm they have the right to the likeness and voice. */
  needsConsent?: boolean;
};

export const PIPELINE_IDS = [
  "animated_graphics",
  "commercial_ad",
  "product_showcase",
  "clone",
  "cinematic_short",
  "ugc_influencer",
  "social_video",
  "explainer",
  "trailer",
  "photo_to_video",
] as const;
export type PipelineId = (typeof PIPELINE_IDS)[number];

export function isPipelineId(value: unknown): value is PipelineId {
  return typeof value === "string" && (PIPELINE_IDS as readonly string[]).includes(value);
}

/* Shared question shapes, so the same thing is asked the same way everywhere. */
const ASPECT: Question = { id: "aspect", label: "Format", options: ["Vertical 9:16", "Square 1:1", "Landscape 16:9"], initial: "Vertical 9:16" };
const ASPECT_WIDE: Question = { ...ASPECT, initial: "Landscape 16:9" };
const LENGTH_SHORT: Question = { id: "length", label: "Length", options: ["15s", "30s", "60s"], initial: "30s" };
const VOICE: Question = { id: "voice", label: "Voiceover", options: ["Female", "Male", "No voiceover"], initial: "Female" };
const TONE: Question = { id: "tone", label: "Tone", options: ["Bold", "Friendly", "Premium", "Playful", "Serious"], initial: "Friendly" };
const PLATFORM: Question = { id: "platform", label: "Platform", options: ["TikTok", "Instagram Reels", "YouTube Shorts", "All of them"], initial: "All of them" };

export const PIPELINES: Record<PipelineId, Pipeline> = {
  animated_graphics: {
    id: "animated_graphics",
    label: "Animated Graphics",
    blurb: "Motion graphics, kinetic type, logos, diagrams",
    icon: "Sparkles",
    stages: ["Idea", "Style frames", "Script", "Motion design", "Music", "Captions", "Render"],
    questions: [
      { id: "style", label: "Style", options: ["Clean & minimal", "Bold kinetic type", "3D shapes", "Hand-drawn", "Corporate"], initial: "Clean & minimal" },
      ASPECT,
      LENGTH_SHORT,
      { id: "voice", label: "Voiceover", options: ["Female", "Male", "Music only"], initial: "Music only" },
    ],
    director: [
      "Everything is designed motion: animated typography, shapes, icons, diagrams, logo reveals, transitions. No live-action people.",
      "Each scene names its motion precisely (e.g. 'headline types on letter by letter, underline draws left to right, 0.4s ease-out').",
      "Keep one colour palette and one typeface pair across all scenes and state them in the style lock.",
    ],
    defaultEngine: "image",
    engines: ["image", "video"],
  },
  commercial_ad: {
    id: "commercial_ad",
    label: "Commercial Ad",
    blurb: "Polished ads with hooks, actors, product shots, CTA",
    icon: "Megaphone",
    stages: ["Product", "Creative strategy", "Script", "Scenes", "Actors", "Product shots", "Voice", "Music", "Captions", "CTA", "Final ad"],
    questions: [
      { id: "length", label: "Length", options: ["15s", "30s", "60s"], initial: "30s" },
      ASPECT,
      { id: "audience", label: "Audience", options: ["Young adults", "Parents", "Professionals", "Seniors", "Everyone"], initial: "Everyone" },
      { id: "variations", label: "Hooks", options: ["1 version", "3 hook variations"], initial: "3 hook variations" },
      VOICE,
    ],
    director: [
      "Start with a creative strategy: the single insight, the promise, the proof, the audience's objection and how the ad answers it.",
      "Scene 1 is the hook and must land in under 2 seconds. When 3 hook variations are asked for, write three alternative scene-1 hooks in `hooks`.",
      "Include at least one clean product shot and end on a CTA scene with the offer and what to do.",
      "Actors are described by role and look, never as a real, named person.",
    ],
    defaultEngine: "video",
    engines: ["video", "image", "avatar"],
    needsReference: "product",
  },
  product_showcase: {
    id: "product_showcase",
    label: "Product Showcase",
    blurb: "Reveals, demos, rotations, lifestyle scenes",
    icon: "Box",
    stages: ["Product reference", "Product lock", "Shot design", "Scenes", "Music", "Captions", "Render"],
    questions: [
      { id: "style", label: "Style", options: ["Product reveal", "Feature showcase", "360° rotation", "Lifestyle", "Luxury", "App / software"], initial: "Product reveal" },
      ASPECT_WIDE,
      LENGTH_SHORT,
      { id: "voice", label: "Voiceover", options: ["Female", "Male", "Music only"], initial: "Music only" },
    ],
    director: [
      "PRODUCT CONSISTENCY IS LOCKED: write a precise product description (shape, colour, material, logo placement, proportions) into `locks.product`, and every scene's visual and motion prompt must refer to the product exactly as locked — never redesign it.",
      "Use studio lighting, macro detail shots, hero angles and one lifestyle context scene unless the style says otherwise.",
    ],
    defaultEngine: "video",
    engines: ["video", "image"],
    needsReference: "product",
  },
  clone: {
    id: "clone",
    label: "Create Your Clone",
    blurb: "Your own AI presenter, with your authorised likeness and voice",
    icon: "UserRound",
    stages: ["Reference material", "Identity setup", "Voice setup", "Script", "Performance", "Lip sync", "Scenes", "Final video"],
    questions: [
      { id: "presenter", label: "Presenter style", options: ["Talking head", "Walk and talk", "Seated interview", "Presentation"], initial: "Talking head" },
      { id: "background", label: "Background", options: ["Home office", "Studio", "Outdoors", "Branded set"], initial: "Studio" },
      { id: "camera", label: "Camera", options: ["Static", "Slow push-in", "Two angles"], initial: "Slow push-in" },
      { id: "personality", label: "Personality", options: ["Warm", "Energetic", "Calm expert", "Funny"], initial: "Warm" },
      { id: "language", label: "Language", options: ["English", "French", "Spanish", "Portuguese", "German"], initial: "English" },
      ASPECT,
    ],
    director: [
      "The presenter is the person who supplied the reference material, with their authorisation. Describe performance (expression, gestures, pace), never their identity.",
      "Every presenter scene is routed to the avatar engine and carries the exact line to be lip-synced.",
      "Write natural spoken script: short sentences, contractions, one idea per line.",
    ],
    defaultEngine: "avatar",
    engines: ["avatar", "image", "video"],
    needsReference: "person",
    needsConsent: true,
  },
  cinematic_short: {
    id: "cinematic_short",
    label: "Cinematic Short",
    blurb: "Story, characters, worlds and camera movement",
    icon: "Clapperboard",
    stages: ["Story idea", "Story development", "Characters", "World design", "Shot list", "Scenes", "Dialogue", "Sound design", "Music", "Colour finishing", "Final film"],
    questions: [
      { id: "genre", label: "Genre", options: ["Drama", "Sci-fi", "Thriller", "Fantasy", "Comedy", "Brand film"], initial: "Drama" },
      { id: "length", label: "Length", options: ["30s", "60s", "2 min"], initial: "60s" },
      ASPECT_WIDE,
      { id: "look", label: "Look", options: ["Naturalistic", "Moody & dark", "Warm golden", "Neon", "Black & white"], initial: "Naturalistic" },
    ],
    director: [
      "Write a three-act micro-story (setup, turn, resolution). Define every character in `locks.characters` (age, look, wardrobe) and the world in `locks.world`; every scene must match them.",
      "Each scene is a shot with a cinematic shot type (establishing, wide, medium, close-up, insert, POV) and a camera move (dolly, pan, crane, handheld, static).",
      "Dialogue lines go in `voiceover` prefixed with the character's name; describe sound design per scene in `sound`.",
    ],
    defaultEngine: "video",
    engines: ["video", "image"],
  },
  ugc_influencer: {
    id: "ugc_influencer",
    label: "UGC AI Influencer",
    blurb: "Creator-style social content with an AI creator",
    icon: "Smartphone",
    stages: ["Product", "Audience", "Creator", "Hook", "UGC script", "Performance", "Product interaction", "Voice", "Captions", "Social edit", "CTA"],
    questions: [
      { id: "creator", label: "Creator", options: ["Female", "Male"], initial: "Female" },
      { id: "age", label: "Age range", options: ["18–24", "25–34", "35–44", "45+"], initial: "25–34" },
      { id: "energy", label: "Energy", options: ["Chill", "Upbeat", "High energy"], initial: "Upbeat" },
      { id: "setting", label: "Setting", options: ["Bedroom", "Kitchen", "Car", "Gym", "Street", "Bathroom mirror"], initial: "Bedroom" },
      { id: "language", label: "Language", options: ["English", "French", "Spanish", "Portuguese", "Pidgin"], initial: "English" },
      PLATFORM,
    ],
    director: [
      "Shot like a creator filmed it on a phone: handheld selfie framing, natural light, quick jump cuts, talking to camera.",
      "The AI creator is fictional — describe them in `locks.creator` (look, clothing, voice) and keep them identical in every scene. Never imitate a real influencer.",
      "Hook in the first line, then personal experience, product interaction (holding, using, showing results), and a casual CTA.",
      "Captions are on for every line. Add a visible 'AI-generated · Ad' disclosure in the final scene's on-screen text.",
    ],
    defaultEngine: "avatar",
    engines: ["avatar", "video"],
    needsReference: "product",
  },
  social_video: {
    id: "social_video",
    label: "Social Media Video",
    blurb: "Short-form for TikTok, Reels and Shorts",
    icon: "Play",
    stages: ["Idea", "Hook", "Script", "Scenes", "Captions", "CTA", "Render"],
    questions: [
      { id: "format", label: "Format", options: ["Talking head", "Listicle", "Educational", "Storytelling", "Trend style", "Product promo"], initial: "Listicle" },
      PLATFORM,
      { id: "length", label: "Length", options: ["15s", "30s", "60s"], initial: "30s" },
      VOICE,
    ],
    director: [
      "Vertical 9:16. The hook lands in the first 2 seconds; a new visual beat every 2–3 seconds.",
      "Captions are burned in for every spoken line — most people watch muted.",
      "End with a CTA that fits the platform (follow, comment, link in bio).",
    ],
    defaultEngine: "video",
    engines: ["video", "image", "avatar"],
  },
  explainer: {
    id: "explainer",
    label: "Explainer Video",
    blurb: "Make a product, idea or process easy to understand",
    icon: "Lightbulb",
    stages: ["Concept", "Simplify", "Script", "Storyboard", "Visuals", "Voice", "Captions", "Render"],
    questions: [
      { id: "style", label: "Style", options: ["Animated", "Presenter-led", "Screen walkthrough"], initial: "Animated" },
      { id: "length", label: "Length", options: ["30s", "60s", "90s", "2 min"], initial: "60s" },
      ASPECT_WIDE,
      VOICE,
    ],
    director: [
      "Problem → idea → how it works in 3–5 numbered steps → benefit → CTA. One step per scene, numbered on screen.",
      "Plain words: explain it to a smart 12-year-old. Define any term the first time it is used.",
      "Presenter-led scenes route to the avatar engine; animated scenes to image or video.",
    ],
    defaultEngine: "image",
    engines: ["image", "video", "avatar"],
  },
  trailer: {
    id: "trailer",
    label: "Trailer / Teaser",
    blurb: "Dramatic reveals for launches, events, games",
    icon: "Film",
    stages: ["Concept", "Beats", "Shot list", "Scenes", "Title cards", "Sound design", "Music", "Final cut"],
    questions: [
      { id: "for", label: "For", options: ["Product launch", "App launch", "Event", "Game", "Film", "Brand reveal"], initial: "Product launch" },
      { id: "length", label: "Length", options: ["15s", "30s", "60s"], initial: "30s" },
      ASPECT_WIDE,
      { id: "countdown", label: "Countdown", options: ["No date", "Show a launch date"], initial: "No date" },
    ],
    director: [
      "Build tension: slow open, rising pace, a final hard cut to the title card. Alternate title cards with shots.",
      "Keep the reveal for the last two scenes; earlier scenes tease with partial views, silhouettes and close details.",
      "Describe music and sound per scene (riser, hit, silence before the reveal).",
    ],
    defaultEngine: "video",
    engines: ["video", "image"],
  },
  photo_to_video: {
    id: "photo_to_video",
    label: "Photo → Video",
    blurb: "Bring a still image to life with motion",
    icon: "Image",
    stages: ["Photo", "Motion design", "Camera move", "Environment", "Render"],
    questions: [
      { id: "motion", label: "Motion", options: ["Slow push-in", "Parallax", "Orbit", "Environmental (wind, water, light)", "Cinematic pan"], initial: "Parallax" },
      { id: "length", label: "Length", options: ["5s", "10s", "15s"], initial: "5s" },
      ASPECT,
    ],
    director: [
      "The photo is the source frame and must be preserved: describe it in `locks.source` and only add motion, never change its subject.",
      "One to three scenes; each motion prompt names the camera move, what moves in the scene, and its speed.",
    ],
    defaultEngine: "video",
    engines: ["video"],
    needsReference: "photo",
  },
};

/** The grid order on the studio's first screen: nine cards, then Photo → Video. */
export const GRID: PipelineId[] = PIPELINE_IDS.filter((id) => id !== "photo_to_video");

/** Each question's answer, falling back to the question's own default. */
export function answersFor(pipeline: Pipeline, given: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const question of pipeline.questions) {
    const value = given[question.id];
    out[question.id] = value && question.options.includes(value) ? value : (question.initial ?? question.options[0]);
  }
  return out;
}
