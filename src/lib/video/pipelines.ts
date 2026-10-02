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
  /* What picking the card writes into the composer: a complete brief with
     [PLACEHOLDERS] to fill. Its timing matches the pipeline's default length. */
  template: string;
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
    template: "Create a 30-second animated motion-graphics video for [BRAND / PRODUCT], explaining [CORE IDEA] to [TARGET AUDIENCE], formatted vertical 9:16 for [PLATFORM].\nBuild everything from designed motion: kinetic typography, clean shapes, icons, simple diagrams and a logo reveal. No live-action footage.\nTimeline:\n\u2022 0\u20133 sec: Bold hook line types on with a sharp motion accent\n\u2022 3\u201310 sec: Introduce the problem with simple animated icons\n\u2022 10\u201320 sec: Show how [PRODUCT] solves it in 3 animated steps\n\u2022 20\u201326 sec: Highlight the key result: \"[BENEFIT]\"\n\u2022 26\u201330 sec: Logo reveal, tagline and \"[CTA]\"\nVisual style: clean, minimal, modern; smooth easing, purposeful transitions, generous white space, using [BRAND COLORS] and one consistent typeface pair.\nKeep the palette, typography and icon style identical in every scene. Use an upbeat modern music bed with subtle UI clicks and whooshes on transitions.\nAvoid clutter, too much text on screen, inconsistent fonts, jittery motion, low-contrast text and stock-looking clip art.",
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
    template: "Create a polished 30-second commercial ad for [PRODUCT / SERVICE], aimed at [TARGET AUDIENCE] and formatted for [PLATFORM / ASPECT RATIO].\nLead with one clear insight: [CUSTOMER PROBLEM]. Promise: [MAIN PROMISE]. Proof: [PROOF POINT]. Give me 3 alternative opening hooks.\nTimeline:\n\u2022 0\u20132 sec: Scroll-stopping hook that names the problem\n\u2022 2\u20138 sec: Relatable moment of frustration with an actor in a real setting\n\u2022 8\u201318 sec: [PRODUCT] in use \u2014 clean product shots and a satisfying demo of [KEY FEATURE]\n\u2022 18\u201325 sec: The result and emotional payoff: \"[BENEFIT]\"\n\u2022 25\u201330 sec: Offer and call to action: \"[CTA]\" with logo\nVisual style: premium, warm and cinematic, natural light, shallow depth of field, confident pacing, using [BRAND COLORS].\nKeep the product's look, packaging, colors and logo perfectly consistent. Use a warm female voiceover, an energetic modern music build and burned-in captions.\nAvoid cheesy acting, generic stock footage, altered branding, unreadable labels, cluttered frames and claims I didn't provide.",
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
    template: "Create a premium 15-second cinematic product showcase for [PRODUCT], aimed at [TARGET AUDIENCE] and formatted for [PLATFORM / ASPECT RATIO].\nOpen with the product emerging dramatically from darkness, mist, liquid, particles, or another environment inspired by its materials and purpose. Use elegant camera movement, macro close-ups, slow rotations, and crisp detail shots to reveal its design and craftsmanship.\nTimeline:\n\u2022 0\u20133 sec: Mysterious silhouette and dramatic reveal\n\u2022 3\u20137 sec: Macro shots highlighting materials and details\n\u2022 7\u201311 sec: Demonstrate [KEY FEATURE] with a visually satisfying action\n\u2022 11\u201313 sec: Showcase the main benefit: \"[BENEFIT]\"\n\u2022 13\u201315 sec: Clean hero shot with logo, tagline, and \"[CTA]\"\nVisual style: luxurious, minimal, photorealistic, high contrast, controlled reflections, cinematic lighting, shallow depth of field, smooth motion, and a polished studio environment using [BRAND COLORS].\nKeep the product's shape, dimensions, packaging, labels, colors, and logo perfectly consistent throughout. Use subtle sound design\u2014metallic clicks, soft impacts, elegant whooshes\u2014and a modern cinematic music build.\nAvoid warped geometry, altered branding, floating parts, unreadable labels, unnecessary props, shaky movement, cluttered backgrounds, and unrealistic reflections.",
    icon: "Box",
    stages: ["Product reference", "Product lock", "Shot design", "Scenes", "Music", "Captions", "Render"],
    questions: [
      { id: "style", label: "Style", options: ["Product reveal", "Feature showcase", "360° rotation", "Lifestyle", "Luxury", "App / software"], initial: "Product reveal" },
      ASPECT_WIDE,
      { ...LENGTH_SHORT, initial: "15s" },
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
    template: "Create a 30-second talking-head video of me presenting [TOPIC] to [TARGET AUDIENCE], formatted vertical 9:16 for [PLATFORM], in [LANGUAGE].\nI speak straight to camera in a clean studio with a slow push-in, warm and confident, like explaining it to a friend.\nTimeline:\n\u2022 0\u20133 sec: Hook \u2014 \"[OPENING LINE]\"\n\u2022 3\u201312 sec: The problem or question, in my own words\n\u2022 12\u201324 sec: My 3 key points about [TOPIC]\n\u2022 24\u201330 sec: Wrap-up and \"[CTA]\"\nVisual style: soft key light, shallow depth of field, natural skin tones, subtle on-screen captions, using [BRAND COLORS] for accents.\nKeep my face, voice, hair and outfit exactly consistent in every shot, with accurate lip sync. Natural pauses, warm delivery, light background music.\nAvoid uncanny expressions, robotic delivery, mismatched lip sync, distracting backgrounds and on-screen text that covers my face.",
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
    template: "Create a 60-second cinematic short film about [STORY IDEA], set in [WORLD / LOCATION], landscape 16:9 with a naturalistic look.\nMain character: [CHARACTER \u2014 age, look, wardrobe]. Tell a complete three-act micro-story with real emotion and a clear turn.\nTimeline:\n\u2022 0\u201310 sec: Establishing shot of the world and the character's normal moment\n\u2022 10\u201325 sec: Inciting moment \u2014 something changes\n\u2022 25\u201345 sec: Rising tension, close-ups, the choice\n\u2022 45\u201355 sec: The turn and its emotional payoff\n\u2022 55\u201360 sec: Final image and title card: \"[TITLE]\"\nVisual style: cinematic, naturalistic color grade, motivated lighting, anamorphic framing, dolly and slow handheld moves, shallow depth of field.\nKeep the character's face, wardrobe and the world's look consistent in every shot. Use layered sound design, sparse dialogue and an emotional score that builds to the turn.\nAvoid inconsistent faces, jump-cut confusion, melodrama, over-saturated colors and anything that breaks the film's reality.",
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
    template: "Create a 30-second UGC-style video of an AI creator (woman, 25\u201334, upbeat) recommending [PRODUCT] to [TARGET AUDIENCE], filmed selfie-style in a bedroom, for TikTok, Reels and Shorts.\nIt should feel authentic and unscripted \u2014 like a real person sharing something they love.\nTimeline:\n\u2022 0\u20132 sec: Hook to camera \u2014 \"[HOOK LINE]\"\n\u2022 2\u201310 sec: Her honest problem before [PRODUCT]\n\u2022 10\u201320 sec: Holding and using [PRODUCT], showing [KEY FEATURE] up close\n\u2022 20\u201326 sec: The result she noticed: \"[BENEFIT]\"\n\u2022 26\u201330 sec: Casual CTA \u2014 \"[CTA]\"\nVisual style: handheld phone footage, natural window light, quick jump cuts, bold burned-in captions for every line.\nKeep the creator's face, outfit and voice identical in every shot, and the product's packaging and logo exactly as in my reference. Mark the final frame \"AI-generated \u00b7 Ad\".\nAvoid looking like a polished ad, fake reactions, warped hands, altered branding and imitating any real influencer.",
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
    template: "Create a 30-second vertical 9:16 short-form video for [PLATFORM] about [TOPIC], aimed at [TARGET AUDIENCE], as a \"[NUMBER] things\" listicle.\nFast, punchy and made to be watched with the sound off.\nTimeline:\n\u2022 0\u20132 sec: Hook \u2014 \"[HOOK LINE]\"\n\u2022 2\u20138 sec: Point 1: [POINT 1]\n\u2022 8\u201315 sec: Point 2: [POINT 2]\n\u2022 15\u201322 sec: Point 3: [POINT 3]\n\u2022 22\u201330 sec: Payoff and \"[CTA]\" (follow, comment or link in bio)\nVisual style: bold, bright and high-energy; a new visual beat every 2\u20133 seconds; big burned-in captions; using [BRAND COLORS].\nKeep the caption style and colors consistent across all points. Female voiceover, trending-style upbeat music, quick whoosh transitions.\nAvoid slow openings, walls of text, low-contrast captions, generic stock clips and anything that needs sound to make sense.",
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
    template: "Create a 60-second animated explainer video about [PRODUCT / CONCEPT] for [TARGET AUDIENCE], landscape 16:9.\nExplain it so simply a smart 12-year-old would get it.\nTimeline:\n\u2022 0\u20138 sec: The problem \u2014 \"[PROBLEM]\"\n\u2022 8\u201315 sec: Introduce [PRODUCT] as the solution\n\u2022 15\u201345 sec: How it works in 3 numbered steps: [STEP 1], [STEP 2], [STEP 3]\n\u2022 45\u201355 sec: The main benefit: \"[BENEFIT]\"\n\u2022 55\u201360 sec: Logo and \"[CTA]\"\nVisual style: friendly, clean isometric or flat illustration, smooth transitions between steps, step numbers on screen, using [BRAND COLORS].\nKeep characters, icons and colors consistent from scene to scene. Clear, warm female voiceover; light, optimistic music.\nAvoid jargon, crowded scenes, too much on-screen text, inconsistent illustration styles and rushed pacing.",
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
    template: "Create a dramatic 30-second teaser trailer for the launch of [PRODUCT / EVENT / APP], aimed at [TARGET AUDIENCE], landscape 16:9.\nBuild anticipation \u2014 tease, don't tell. Save the full reveal for the end.\nTimeline:\n\u2022 0\u20135 sec: Slow, mysterious open \u2014 darkness, silhouettes, a single sound\n\u2022 5\u201315 sec: Quick glimpses of details, cut between bold title cards: \"[TEASER LINE 1]\", \"[TEASER LINE 2]\"\n\u2022 15\u201324 sec: Rising pace and music, faster cuts, partial views\n\u2022 24\u201327 sec: A beat of silence\n\u2022 27\u201330 sec: Hard cut to the reveal, logo and \"[LAUNCH DATE / CTA]\"\nVisual style: epic and cinematic, high contrast, volumetric light, lens flares, dramatic camera moves, using [BRAND COLORS].\nKeep the product and branding consistent in every glimpse. Trailer sound design: risers, deep hits, silence before the reveal, then a big final impact.\nAvoid revealing everything too early, cheesy effects, unreadable title cards and cluttered frames.",
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
    template: "Bring my photo of [SUBJECT] to life as a 5-second vertical 9:16 video.\nKeep the photo exactly as it is \u2014 same subject, framing, colors and details \u2014 and add only motion.\nMotion: gentle parallax between foreground and background, a slow cinematic push-in, and subtle natural movement in [ELEMENTS THAT SHOULD MOVE \u2014 hair, water, clouds, light].\nVisual style: smooth, realistic, cinematic depth, soft natural light.\nAvoid changing the subject's face or shape, warping, flicker, added objects and unnatural movement.",
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
