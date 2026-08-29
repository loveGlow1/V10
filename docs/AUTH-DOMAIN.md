# Putting sign-in on auth.quickstark.tech

Today the Google sign-in sheet reads:

> to continue to **esuatccbicekcohzgcvd.supabase.co**
> Before using this app, you can review esuatccbicekcohzgcvd.supabase.co's
> Privacy Policy and Terms of Service.

That is the first screen a new account sees, and it does not say QuickStark.Ai.

**This is not a leak.** The project ref is already compiled into every build as
`NEXT_PUBLIC_SUPABASE_URL`, so anyone who loads the site can read it. Row Level
Security is what protects the data, not the secrecy of that hostname. It is a
branding problem, and the only fix is to give the auth server a hostname of
yours: `auth.quickstark.tech`.

Afterwards the same sheet reads "to continue to **auth.quickstark.tech**".

## What it costs

Supabase's **Custom Domains** add-on, about $10 per month per project, enabled
per project rather than per organisation. There is no free path — the hostname
in that sentence is the hostname serving the request, and only Supabase can
serve `auth.quickstark.tech`.

## What changes in this repository

One value: `NEXT_PUBLIC_SUPABASE_URL`. Everything reads the auth host from that
environment variable and nothing hardcodes `.supabase.co`, so the swap is an
env change and a redeploy, with no code change at all.

Session cookies are unaffected. `@supabase/ssr` writes them on the site's own
domain, not the auth domain, so signed-in visitors stay signed in.

## The order to do it in

Steps 1–5 are all outside this repository, and each one is invisible from the
others. Run `npm run check:auth-domain auth.quickstark.tech` after each — it
reads DNS, the certificate, the health endpoint and the environment in one go
and names whichever one is still wrong.

### 1. Enable the add-on

**Supabase → Project Settings → Add-ons → Custom Domains**, on project
`esuatccbicekcohzgcvd`. Confirm the project ref before you pay: there is a
second project on this account (`etmbtqjxgsxblownwypm`) that the app does not
use, and an add-on bought there does nothing.

### 2. Claim the hostname

With the Supabase CLI, logged in as the project owner:

```
supabase login
supabase domains create --project-ref esuatccbicekcohzgcvd \
  --custom-hostname auth.quickstark.tech
```

It prints the DNS records to create — including the TXT values, which are
generated per project and cannot be written down here in advance.

### 3. Add the DNS records

At whichever registrar or DNS host serves `quickstark.tech`:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `auth` | `esuatccbicekcohzgcvd.supabase.co` |
| TXT | `_cf-custom-hostname.auth` | the value printed in step 2 |
| TXT | `_acme-challenge.auth` | the value printed in step 2 |

Use a low TTL (60–300s) while you are cutting over, so a mistake is minutes to
undo rather than a day.

Two traps, in the order people hit them:

- Many registrars append the zone to whatever you type. If the record ends up as
  `_acme-challenge.auth.quickstark.tech.quickstark.tech`, enter just
  `_acme-challenge.auth` — or, on hosts that do not append, the full name.
- If `quickstark.tech` is proxied through Cloudflare, the `auth` record must be
  **DNS only** (grey cloud). Proxying it puts Cloudflare in front of Supabase's
  own certificate and verification never completes.

### 4. Verify and activate

```
supabase domains reverify --project-ref esuatccbicekcohzgcvd
```

Expect to run this more than once: it fails until the records have propagated,
and certificate issuance can take up to 30 minutes. Then:

```
supabase domains activate --project-ref esuatccbicekcohzgcvd
```

Activation is the switch. From this point the project answers on both hostnames.

### 5. Point the app and Google at it

Three places, all of which must name the new host:

**Vercel → Settings → Environment Variables** — set
`NEXT_PUBLIC_SUPABASE_URL` to `https://auth.quickstark.tech` for Production
(and Preview, if previews sign in). This is read at build time as well as at
run time, so **redeploy** — restarting is not enough. Change it in `.env` here
too, so a local build matches production.

**Google Cloud console → APIs & Services → Credentials → your OAuth client:**

| Field | Value |
| --- | --- |
| Authorised JavaScript origins | `https://auth.quickstark.tech` |
| Authorised redirect URIs | `https://auth.quickstark.tech/auth/v1/callback` |

Keep the old `https://esuatccbicekcohzgcvd.supabase.co/auth/v1/callback` entry
until the new one is confirmed working; remove it afterwards. Google takes a few
minutes to apply a redirect URI change, and sometimes longer.

**Supabase → Authentication → URL Configuration** does *not* change. Site URL
and Redirect URLs name the site the visitor comes back to, not the auth host:

```
Site URL       https://www.quickstark.tech
Redirect URLs  https://www.quickstark.tech/auth/callback
               http://localhost:3000/auth/callback
```

### 6. Check it

```
npm run check:auth-domain auth.quickstark.tech
```

Then sign in with Google in a private window and read the sheet: it should say
"to continue to auth.quickstark.tech".

## If it goes wrong

The old hostname keeps working the whole time — activation adds a name, it does
not remove one. So the way back is to set `NEXT_PUBLIC_SUPABASE_URL` in Vercel
to `https://esuatccbicekcohzgcvd.supabase.co` and redeploy; sign-in is working
again as soon as that deploy is live, and you can leave the DNS and the add-on
in place while you work out what was wrong.

The failure that looks worst is the least serious: `redirect_uri_mismatch` after
approving Google. It means Google has not been told about
`https://auth.quickstark.tech/auth/v1/callback` yet, or was told minutes ago and
has not applied it. Nothing is broken — wait, or check the entry for a typo.

## While you are in the Google console

The client secret for this OAuth client was pasted into a chat transcript and
should be treated as exposed. **Reset it** (Credentials → your client → Reset
secret) and paste the new one into Supabase → Authentication → Providers →
Google. The value starts with `GOCSPX-`; that prefix is part of the secret and
Supabase rejects it silently if it is missing.
