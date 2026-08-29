# Quickstark.Ai (V10)

An automated, high-velocity AI SaaS application building platform.

## Core Architecture
- **Framework**: Next.js 15 (App Router)
- **Database & Auth**: Supabase SSR
- **Design System**: Tailwind CSS & Lucide Icons
- **Graphics**: Isolated Live 3D Canvas Element

## Development Setup
1. Install the explicit engine dependencies:
   ```bash
   npm install
   ```
2. Supply your local environment variables in `.env.local`.
3. Spin up the development server locally:
   ```bash
   npm run dev
   ```

## Supabase Environment Configuration (Required for Auth)

Authentication requires both public Supabase variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Where to find these values

In your Supabase project dashboard:

1. Open **Project Settings** → **API**
2. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **Project API keys** → **anon/public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Local development

Add these values in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

### Vercel deployment

For the Vercel project:

1. Go to **Project Settings** → **Environment Variables**
2. Add both variables for **Production**, **Preview**, and **Development**
3. Redeploy after saving variables (required for the deployment to pick them up)

Without these variables, sign-up/sign-in/OAuth/OTP flows will be unavailable.

### Deployment health check

The app exposes `GET /api/health` with `supabaseConfigured` status.
- In non-production, it also returns `missingSupabaseEnvVars`.
- In production, detailed missing-var names are hidden by default; set `SUPABASE_HEALTH_INCLUDE_DETAILS=true` only when you explicitly need detailed diagnostics.