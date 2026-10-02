# GitHub

GitHub touches QuickStark in two separate places, each with its own OAuth App.

| | Sign in with GitHub | Connect GitHub (push code) |
|---|---|---|
| Where | Landing page and login modal | App → Manage → Integrations → GitHub; account menu → Connect to GitHub |
| Who handles OAuth | Supabase Auth | This app (`/api/integrations/github/*`) |
| Scopes | your identity only | `repo`, `read:user` |
| Plans | all | connecting: all · **pushing: Standard and Pro** |

## 1. Sign in with GitHub (Supabase Auth)

The buttons already call `supabase.auth.signInWithOAuth({ provider: "github" })`
and come back through `/auth/callback`. To turn it on:

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**
   - Homepage URL: `https://www.quickstark.tech`
   - Authorization callback URL: `https://<your-supabase-host>/auth/v1/callback`
     (the value of `NEXT_PUBLIC_SUPABASE_URL` + `/auth/v1/callback`)
2. Supabase dashboard → Authentication → Providers → **GitHub**: enable it and
   paste the client ID and secret.
3. Supabase → Authentication → URL Configuration: make sure
   `https://www.quickstark.tech/auth/callback` is in **Redirect URLs**.

## 2. Connect GitHub (push an app's code)

1. Create a **second** OAuth App:
   - Authorization callback URL: `https://www.quickstark.tech/api/integrations/github/callback`
2. In Vercel → Environment Variables set `GITHUB_OAUTH_CLIENT_ID` and
   `GITHUB_OAUTH_CLIENT_SECRET` (and `GITHUB_OAUTH_REDIRECT_URL` only if the
   callback is not on the same host).
3. Run `supabase/migrations/20261002060000_github_connections.sql`.

### How it works

- `GET /api/integrations/github/authorize?next=/path` — PKCE + state in an
  httpOnly cookie, then off to GitHub.
- `GET /api/integrations/github/callback` — checks state and the signed-in
  user, exchanges the code server-side, stores the token **sealed**
  (AES-256-GCM, key derived from the client secret) in `github_connections`,
  a table only the service role can touch. Returns to `next?github=<result>`.
- `GET /api/integrations/github` — connected?, login, `canPush`.
  `DELETE` disconnects and revokes the grant on GitHub.
- `GET /api/projects/:id/github` — the drawer's state, including the linked repo.
- `POST /api/projects/:id/github` — **402 on the Free plan.** Otherwise pushes
  the project's current files as one commit (Git Data API: tree → commit →
  move branch). The first push creates the repository (private by default) and
  records it in `project_github_repos`; later pushes go to the same repo. Files
  deleted in QuickStark are deleted in the next commit; history is kept.

Rotating `GITHUB_OAUTH_CLIENT_SECRET` makes stored tokens unreadable — everyone
reads as "not connected" and presses Connect GitHub once more.
