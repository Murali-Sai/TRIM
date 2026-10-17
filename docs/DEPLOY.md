# Deploying TRIM

TRIM is a website. The browser loads it from one domain, `https://app.<your-domain>`, and every
`/api/*` request goes to the same domain. A Cloudflare Pages Function forwards those to the
FastAPI service on Google Cloud Run. Because the browser never talks to a second site, the
session cookie is first-party, which Safari requires (SPEC page 2, "One origin").

```
Browser ──> https://app.<domain>/            Cloudflare Pages (static files from web/dist)
        └─> https://app.<domain>/api/*        Pages Function web/functions/api/[[path]].ts
                                                └─> https://<service>.run.app/api/*  (Cloud Run)
```

Task 1.8 is built and tested locally. What is left needs your accounts: the steps below, then
the Safari check at the end.

## 1. Shared secret

The Pages Function adds `X-Trim-Proxy-Secret` to every request. With `TRIM_PROXY_SECRET` set, the
API refuses any `/api` request without it, so nobody can call Cloud Run directly to skip the
proxy or fake `X-Forwarded-For` (the login lockout counts per IP). Generate one value and use it
in both places:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

## 2. Cloud Run (API)

Deploy the API image to Cloud Run in `us-central1` with minimum instances 0 and
unauthenticated invocations allowed (the shared secret does the gatekeeping). Set these
environment variables, keeping the secret ones in Secret Manager:

| Variable | Value |
|---|---|
| `TRIM_ENV` | `prod` (the API refuses to start in prod with any dev default left) |
| `TRIM_DATABASE_URL` | Neon connection string for the app login role (member of `trim_app`, no BYPASSRLS) |
| `TRIM_MIGRATION_DATABASE_URL` | Neon connection string for the schema owner (used only by Alembic) |
| `TRIM_APP_BASE_URL` | `https://app.<domain>` |
| `TRIM_COOKIE_SECURE` | `true` (cookies get the `__Host-` prefix) |
| `TRIM_PROXY_SECRET` | the value from step 1 (32+ characters) |
| `TRIM_IP_HASH_PEPPER` | another random value |
| `TRIM_TURNSTILE_SECRET` | from the Turnstile widget |
| `TRIM_RESEND_API_KEY` | from Resend, with your domain verified |
| `TRIM_EMAIL_FROM` | for example `TRIM <no-reply@<domain>>` |

On Neon, create the roles once (the Docker database does this in `db/init/01-roles.sql`):
`trim_app` NOLOGIN NOBYPASSRLS, and a login role that is a member of it. Then run
`uv run alembic upgrade head` with the owner URL.

## 3. Cloudflare Pages (website and proxy)

Create a Pages project from the GitHub repository:

| Setting | Value |
|---|---|
| Root directory | `web` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable `NODE_VERSION` | `22` |
| Environment variable `VITE_TURNSTILE_SITE_KEY` | the Turnstile site key (public by design) |
| Variable `API_ORIGIN` (Functions) | the Cloud Run URL, for example `https://trim-api-xyz-uc.a.run.app` |
| Secret `PROXY_SECRET` (Functions) | the value from step 1 |

`web/public/_routes.json` limits the Function to `/api/*`; everything else is served as static
files, and unknown paths fall back to `index.html` for the app's own routes. Add the custom
domain `app.<domain>` to the project.

## 4. The Safari check (task 1.8 acceptance)

On an iPhone in Safari and on a Mac in Safari, at `https://app.<domain>`:

1. Sign up, open the verification link, and log in with "Keep me signed in".
2. Reload: you stay signed in (the session cookie was stored).
3. Close Safari completely, reopen the site: still signed in.
4. Log out, then log in without "Keep me signed in"; quit Safari and reopen: signed out.
5. In Safari's Web Inspector, Storage, Cookies: `__Host-trim_session` is HttpOnly, Secure,
   SameSite Lax and set by `app.<domain>`; `__Host-trim_csrf` is not HttpOnly.

When all five pass on both devices, mark 1.8 `[x]` in TASKS.md.

## Local development

No proxy is needed locally: the Vite dev server forwards `/api` to `http://127.0.0.1:8000`, so
the page and the API already share one origin. The proxy's own tests run with the web tests
(`web/edge/proxy.test.ts`), including a real HTTP server standing in for Cloud Run.
