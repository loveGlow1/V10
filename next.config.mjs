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
  /* Tailwind runs on the server, in /preview/[projectId]?download=1, to compile
     a downloaded page's stylesheet into the file (src/lib/standalone-page.ts).
     It has to be required from node_modules at runtime rather than bundled.
     
     Tailwind reads its own files off disk — `preflight` is a literal
     readFileSync of preflight.css — and webpack rewrites that path into the
     chunk directory, where the file does not exist. Bundled, the compile threw
     ENOENT on every download; the route caught it, fell back to the stored HTML
     and served exactly the unstyled page this was written to fix. It looked
     like the fix had not deployed.
     
     Listing it here leaves the require alone, so the package keeps its own
     files beside it. postcss goes with it because Tailwind is loaded through
     it. */
  serverExternalPackages: ["tailwindcss", "postcss"],
};

export default nextConfig;
