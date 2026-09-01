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
