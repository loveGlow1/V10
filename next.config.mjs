const requiredSupabasePublicEnvVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

const missingSupabasePublicEnvVars = requiredSupabasePublicEnvVars.filter(
  (key) => !process.env[key],
);

if (missingSupabasePublicEnvVars.length > 0) {
  // eslint-disable-next-line no-console
  console.warn(
    `[startup] Supabase public env vars missing: ${missingSupabasePublicEnvVars.join(", ")}. ` +
      "Authentication will be unavailable until these values are set and the app is redeployed.",
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* Whether ChatGPT and Gemini are offered in the model picker: "on" when
     their key is set on this deployment, decided at build time so the
     browser knows without ever seeing a key (src/app/dashboard/models.ts).
     AI_OPENAI=off / AI_GOOGLE=off keep one switched off with its key set. */
  env: {
    NEXT_PUBLIC_AI_OPENAI: process.env.OPENAI_API_KEY?.trim() && process.env.AI_OPENAI !== "off" ? "on" : "",
    NEXT_PUBLIC_AI_GOOGLE: (process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()) && process.env.AI_GOOGLE !== "off" ? "on" : "",
  },
  /* ffmpeg for the final cut of a video (src/lib/video/compose-local.ts).
     ffmpeg-static is a path to a binary, not code webpack can bundle, so it
     stays external and the binary is traced into the routes that run it: the
     cut, an upload's preparation (src/lib/video/prepare-asset.ts), and the
     last frame a continuing scene starts from (continue-scene.ts). */
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/video/[id]/render/compose": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/video/[id]/assets/prepare": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/video/[id]/render/continue": ["./node_modules/ffmpeg-static/ffmpeg"],
    /* A still of every made scene, so the AI editor can match a screenshot
       to its scene (src/lib/video/scene-stills.ts). */
    "/api/video/[id]/plan": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/build": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  /* The code editor runs a real terminal — Node.js in the tab, through the
     WebContainer API — which needs the page to be cross-origin isolated. Only
     that page: isolation would stop the rest of the app framing previews and
     loading third-party pictures. Monaco comes from jsDelivr, which sends
     Cross-Origin-Resource-Policy: cross-origin, so it still loads. */
  async headers() {
    return [
      {
        source: "/dashboard/project/:projectId/code",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
  /* Tailwind is deliberately NOT listed in serverExternalPackages.
     
     It was, for one deploy, because its preflight plugin readFileSync's a path
     built from __dirname and webpack rewrote that into a chunk directory where
     the file was not. Externalising it fixed that locally and failed again in
     production, where the package was external and the CSS beside it still did
     not make the trip — /api/health reported downloadsCompile: false on a
     deployment carrying the fix.
     
     Arranging for a file to be somewhere is the part that keeps failing, so the
     read is gone instead: src/lib/tailwind-preflight.ts carries that CSS and
     corePlugins.preflight is off. With no disk read left, the compile is pure
     arithmetic, and bundling it is the option with no tracing step to get
     wrong — what webpack can see is in the function by construction. */
};

export default nextConfig;
