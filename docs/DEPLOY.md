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
| `TRIM_FDC_API_KEY` | a free data.gov key for USDA FoodData Central (1,000 requests an hour); server only |
| `TRIM_OFF_USER_AGENT` | names the app and a contact, for example `TRIM/1.0 (you@<domain>)`, as Open Food Facts asks |
| `TRIM_VAPID_PUBLIC_KEY`, `TRIM_VAPID_PRIVATE_KEY` | Web Push keys for streak reminders (see step 5); without them reminders stay off |
| `TRIM_VAPID_SUBJECT` | a contact for push services, for example `mailto:you@<domain>` |
| `TRIM_JOB_TOKEN` | a long random value the hourly job sends; without it the job is refused |

On Neon, create the roles once (the Docker database does this in `db/init/01-roles.sql`):
`trim_app` NOLOGIN NOBYPASSRLS, and a login role that is a member of it. Then run
`uv run alembic upgrade head` with the owner URL.

## 3. Cloudflare Pages (website and proxy)

GitHub Actions uploads each build (section 7), so create the Pages project as **Direct
Upload**, named `trim` (or set `CF_PAGES_PROJECT`), not connected to Git. In its settings:

| Setting | Value |
|---|---|
| Variable `API_ORIGIN` (Functions) | the Cloud Run URL, for example `https://trim-api-xyz-uc.a.run.app` |
| Secret `PROXY_SECRET` (Functions) | the value from step 1 |

`web/public/_routes.json` limits the Function to `/api/*`; everything else is served as static
files, and unknown paths fall back to `index.html` for the app's own routes. `web/public/_headers`
sets the security headers (task 5.4). Add the custom domain `app.<domain>` to the project.

## 4. The Safari check (task 1.8 acceptance)

On an iPhone in Safari and on a Mac in Safari, at `https://app.<domain>`:

1. Sign up, open the verification link, and log in with "Keep me signed in".
2. Reload: you stay signed in (the session cookie was stored).
3. Close Safari completely, reopen the site: still signed in.
4. Log out, then log in without "Keep me signed in"; quit Safari and reopen: signed out.
5. In Safari's Web Inspector, Storage, Cookies: `__Host-trim_session` is HttpOnly, Secure,
   SameSite Lax and set by `app.<domain>`; `__Host-trim_csrf` is not HttpOnly.

When all five pass on both devices, mark 1.8 `[x]` in TASKS.md.

## 5. Streak reminders (task 3.18)

1. Make a VAPID key pair once, from `api/`:

   ```
   uv run python -c "from py_vapid import Vapid01 as V; v=V(); v.generate_keys(); \
   import base64; from cryptography.hazmat.primitives import serialization as s; \
   print('public', base64.urlsafe_b64encode(v.public_key.public_bytes(s.Encoding.X962, \
   s.PublicFormat.UncompressedPoint)).rstrip(b'=').decode()); \
   print('private', base64.urlsafe_b64encode(v.private_key.private_numbers().private_value \
   .to_bytes(32, 'big')).rstrip(b'=').decode())"
   ```

   Set them as `TRIM_VAPID_PUBLIC_KEY` and `TRIM_VAPID_PRIVATE_KEY` on Cloud Run (the private key as
   a secret). Keep the same pair for good: changing it drops every browser's subscription.
2. Create one Cloud Scheduler job, every hour: `POST https://app.<domain>/api/internal/jobs/hourly`
   with header `X-Job-Token: <TRIM_JOB_TOKEN>` (it goes through the Pages proxy like any /api call).
3. Check on desktop Chrome, and on an iPhone with TRIM added to the Home Screen (iOS 16.4 or later):
   turn on Streak reminder in Account at a time a few minutes ahead, leave today unlogged, and
   wait for the reminder; log something, and check no second reminder arrives that day. When both
   pass, mark 3.18 `[x]` in TASKS.md.

## 6. Food pairing table (task 3.22)

Suggestions use pairing scores built from What We Eat in America. Until the table is loaded
every pair scores 0, so suggestions match the numbers only.

1. Download the most recent cycle's day-1 and day-2 Individual Foods files (`DR1IFF_*.xpt`,
   `DR2IFF_*.xpt`) from the CDC NHANES site, and the FNDDS "Foods and Beverages" table for the
   same cycle from USDA ARS, saved as CSV.
2. Build: `uv run --with pandas python tools/build_pairing.py --day1 ... --day2 ... --fndds ...
   --version "NHANES 2021-2023 ...; FNDDS 2021-2023" --out data/`. It stops on any eating
   occasion code or WWEIA category it does not know.
3. Check `data/pairing_categories.csv` (every WWEIA category and its group), then commit both
   CSV files.
4. Load: `TRIM_OWNER_URL=... uv run python tools/load_pairing.py data/pairing_scores.csv`.

## 7. Automatic deploys (task 5.5)

`.github/workflows/deploy.yml` runs when CI passes on `main` (or by hand from the Actions tab):

1. **API:** builds `api/Dockerfile`, pushes it to Artifact Registry, runs
   `alembic upgrade head` against Neon, then deploys the image to Cloud Run with the settings from
   step 2. Secrets come from Secret Manager by name; plain settings come from repository
   variables.
2. **Site:** builds `web/`, runs the secret grep on the bundle, and uploads `dist` (with the
   Pages Function) to Cloudflare Pages.
3. **Smoke check:** `/api/health` answers through the proxy, and the page and the API both send
   the six security headers.

One-time setup:

1. **Neon.** Create the project and the roles from step 2. Use the pooled connection string
   (host with `-pooler`) for the app login, and the direct one for the owner.
2. **Google Cloud.** In the project:
   - Create an Artifact Registry Docker repository `trim` in `us-central1`.
   - Create a runtime service account for Cloud Run with **Secret Manager Secret Accessor**.
   - Create a deploy service account, `trim-deploy`, with these roles: **Cloud Run Admin**,
     **Artifact Registry Writer**, **Secret Manager Secret Accessor** (it reads the migration
     URL) and **Service Account User** on the runtime account.
   - Set up Workload Identity Federation for GitHub: a pool and an OIDC provider for
     `https://token.actions.githubusercontent.com`, with the attribute condition
     `assertion.repository == "Murali-Sai/TRIM" && assertion.ref == "refs/heads/main"`. Let
     that principal impersonate `trim-deploy` (**Workload Identity User**). No JSON key is ever
     created.
3. **Secret Manager.** Create one secret for each sensitive setting:
   - `trim-database-url`
   - `trim-migration-database-url`
   - `trim-proxy-secret`
   - `trim-ip-hash-pepper`
   - `trim-turnstile-secret`
   - `trim-resend-api-key`
   - `trim-fdc-api-key`
   - `trim-vapid-private-key`
   - `trim-job-token`
4. **GitHub**, in Settings, Secrets and variables, Actions:
   - Variables:
     - `GCP_PROJECT_ID`, `GCP_REGION` (`us-central1`)
     - `GCP_WIF_PROVIDER` (`projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`)
     - `GCP_DEPLOY_SA` (the `trim-deploy` email), `CLOUD_RUN_SERVICE` (`trim-api`), `ARTIFACT_REPO` (`trim`)
     - `APP_URL` (`https://app.<domain>`), `EMAIL_FROM`, `OFF_USER_AGENT`
     - `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`
     - `TURNSTILE_SITE_KEY`, `CF_PAGES_PROJECT`
   - Secrets: `CLOUDFLARE_API_TOKEN` (a token with **Cloudflare Pages: Edit** only) and
     `CLOUDFLARE_ACCOUNT_ID`.
   - Optionally, add required reviewers to the `production` environment so each deploy waits
     for a click.
5. Push to `main`, or run **Deploy** from the Actions tab, and watch the three jobs.

**Secret grep.** `api/tools/secret_grep.py` fails CI if any tracked file holds a private key, a
cloud or service key, a long value assigned to a secret-looking name, or an `.env` file. On
the built site, it also fails on the name of any server-only setting. A documented test value
can be allowed with a `secret-grep: allow` comment on its line.

## 8. Nightly backups and the restore drill (task 5.6)

`.github/workflows/backup.yml` runs every night at 07:17 UTC (and by hand). It has two steps:

1. **Backup.** `ops/backup.sh` dumps Neon (`pg_dump`, custom format, no owners) together with a
   manifest: schema version, exact row counts and the tables with RLS on. It encrypts both with
   [age](https://age-encryption.org) and uploads the file to a private bucket.
2. **Drill.** The same file is downloaded and decrypted with the drill key. `ops/restore-drill.sh`
   then restores it into an empty Postgres and fails unless the schema version, every table's
   row count and RLS all match the manifest.

GitHub emails the repository's admins when a scheduled run fails.

One-time setup:

1. Make two age keys with `age-keygen -o owner.key` and `age-keygen -o drill.key`.
   - Keep `owner.key` offline, in your password manager: it is the one you restore with.
   - Put the whole of `drill.key` in the GitHub secret `BACKUP_DRILL_IDENTITY`.
   - Set the variable `BACKUP_AGE_RECIPIENTS` to both public keys, space separated (from
     `age-keygen -y owner.key` and `age-keygen -y drill.key`).
2. Create a private Cloud Storage bucket in `us-central1` with uniform access and a lifecycle
   rule that deletes objects after 30 days. Set its name as the variable `BACKUP_BUCKET`.
3. Create a service account `trim-backup`, then give it access to only what it needs:
   - On that bucket: **Storage Object Creator** and **Storage Object Viewer**.
   - On `trim-migration-database-url`: **Secret Manager Secret Accessor**.
   - Let the GitHub principal from section 7 impersonate it (**Workload Identity User**).
   - Set the variable `GCP_BACKUP_SA` to its email.
4. Run **Backup** from the Actions tab once and check both jobs pass.

To restore for real:

1. Download a file with `gcloud storage cp gs://<bucket>/daily/<file> .`.
2. Restore it into an empty database, such as a new Neon branch:
   `TARGET_URL=postgresql://<owner>@<host>/<db> AGE_IDENTITY=owner.key ops/restore-drill.sh <file>`.
   It creates the roles, restores and checks the result.
3. Point `trim-database-url` and `trim-migration-database-url` at that database.

The same drill runs in the API tests (`tests/test_backup_drill.py`) against the test database.

## Local development

No proxy is needed locally: the Vite dev server forwards `/api` to `http://127.0.0.1:8000`, so
the page and the API already share one origin. The proxy's own tests run with the web tests
(`web/edge/proxy.test.ts`), including a real HTTP server standing in for Cloud Run.
