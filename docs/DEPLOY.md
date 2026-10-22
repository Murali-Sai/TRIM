# Deploying TRIM for $0

Every service below has a free plan that needs no card, so nothing can ever be charged. When
a free limit is reached the service stops or slows down; it never bills.

| Piece | Service | Free plan |
|---|---|---|
| Website and `/api` proxy | Cloudflare Pages, at `https://<project>.pages.dev` | Static files free; 100,000 Function requests a day |
| API | Render free web service (Docker, `render.yaml`) | 750 hours a month, 512 MB, sleeps after 15 minutes idle |
| Database | Neon Free | 0.5 GB |
| Email | Gmail over SMTP with an app password | About 500 recipients a day |
| Sign-up check | Cloudflare Turnstile | Unlimited |
| Food data | USDA FoodData Central (data.gov key), Open Food Facts | 1,000 requests an hour; no key |
| Hourly job and nightly backups | GitHub Actions (`hourly.yml`, `backup.yml`) | Unlimited minutes on a public repository |

The browser only talks to the `pages.dev` site. A Cloudflare Pages Function forwards every
`/api/*` request to the API on Render, so the session cookie is first-party, which Safari
requires (SPEC page 2, "One origin").

```
Browser ──> https://<project>.pages.dev/         Cloudflare Pages (static files from web/dist)
        └─> https://<project>.pages.dev/api/*     Pages Function web/functions/api/[[path]].ts
                                                    └─> https://trim-api.onrender.com/api/*
```

**Cold starts.** The free API sleeps after 15 minutes without a request. The next visit wakes
it, which takes about 30 to 60 seconds; the site pings `/api/health` as soon as it loads so
the wait overlaps with the page. The hourly job wakes it once an hour too.

Do the steps in order. Keep a note open for the values you collect; each is marked
**(save)**. None of them go in the repository.

## 1. Neon (database)

1. Sign up at neon.com and create a project in **AWS US East 2 (Ohio)**, next to Render's Ohio
   region.
2. In the SQL editor, as the owner role, create the API's roles (pick your own password):

   ```sql
   CREATE ROLE trim_app NOLOGIN NOBYPASSRLS;
   CREATE ROLE trim_api LOGIN NOBYPASSRLS PASSWORD '<password>' IN ROLE trim_app;
   ```

3. From **Connect**, copy two connection strings and change `postgresql://` at the start of each
   to `postgresql+psycopg://`:
   - the **pooled** one (host with `-pooler`) with user `trim_api` and your password: the
     **app URL (save)**;
   - the **direct** one for the owner role: the **owner URL (save)**.

## 2. Gmail (email)

1. On the Google account that will send TRIM's emails, turn on 2-Step Verification.
2. At myaccount.google.com/apppasswords, create an app password named `TRIM`. Copy the 16
   letters without spaces: the **app password (save)**.

Emails come from this Gmail address.

## 3. Keys you make yourself

1. A data.gov API key, free, from api.data.gov/signup: the **FDC key (save)**.
2. Web Push keys for streak reminders. In any terminal with OpenSSL (macOS, Linux, or Git Bash
   on Windows):

   ```bash
   key="$(openssl ecparam -name prime256v1 -genkey -noout)"
   b64url() { base64 | tr '+/' '-_' | tr -d '=\n'; }
   echo "public  $(openssl ec -pubout -outform DER <<<"$key" 2>/dev/null | tail -c 65 | b64url)"
   echo "private $(openssl ec -outform DER <<<"$key" 2>/dev/null | tail -c +8 | head -c 32 | b64url)"
   ```

   The **VAPID public key (save)** and **VAPID private key (save)**. Keep the same pair for
   good: changing it drops every browser's reminder subscription.
3. Two backup keys, with [age](https://age-encryption.org) installed:
   `age-keygen -o owner.key` and `age-keygen -o drill.key`.
   - Keep `owner.key` offline, in your password manager: it is the one you restore with.
   - The whole of `drill.key` is the **drill identity (save)**.
   - `age-keygen -y owner.key` and `age-keygen -y drill.key` print the two public keys; both,
     with a space between them, are the **backup recipients (save)**.

## 4. Cloudflare (website, proxy, Turnstile)

1. Sign up at cloudflare.com. Under **Workers & Pages**, create a Pages project with **Direct
   Upload**, named `trim`, and upload any small folder to finish creating it. Its address,
   such as `https://trim-abc.pages.dev`, is the **app URL (save)**.
2. Under **Turnstile**, add a widget for that `pages.dev` hostname, mode Managed: the **site
   key (save)** and **secret key (save)**.
3. Under **My Profile, API Tokens**, create a custom token with only **Account, Cloudflare
   Pages, Edit**: the **Cloudflare token (save)**. The **account ID (save)** is on the Workers
   & Pages overview.

## 5. Render (API)

1. Sign up at render.com with GitHub, and allow it to read `Murali-Sai/TRIM`.
2. **New, Blueprint**, pick the repository. Render reads `render.yaml` and asks for:

   | Variable | Value |
   |---|---|
   | `TRIM_APP_BASE_URL` | the app URL from step 4 |
   | `TRIM_DATABASE_URL` | the Neon app URL (pooled, `trim_api`) |
   | `TRIM_SMTP_USER` | the Gmail address |
   | `TRIM_SMTP_PASSWORD` | the app password |
   | `TRIM_EMAIL_FROM` | `TRIM <you@gmail.com>`, with the same address |
   | `TRIM_TURNSTILE_SECRET` | the Turnstile secret key |
   | `TRIM_FDC_API_KEY` | the data.gov key |
   | `TRIM_OFF_USER_AGENT` | `TRIM/1.0 (you@gmail.com)`, as Open Food Facts asks |
   | `TRIM_VAPID_PUBLIC_KEY`, `TRIM_VAPID_PRIVATE_KEY` | the two Web Push keys |
   | `TRIM_VAPID_SUBJECT` | `mailto:you@gmail.com` |
   | `TRIM_ALERT_EMAIL` | where free-tier usage alerts go (see "Usage alerts") |

   Render generates `TRIM_PROXY_SECRET`, `TRIM_IP_HASH_PEPPER` and `TRIM_JOB_TOKEN` itself.
3. When the service exists, copy from its page:
   - its address, such as `https://trim-api.onrender.com`: the **Render URL (save)**;
   - under **Environment**, the values of `TRIM_PROXY_SECRET` (**proxy secret (save)**) and
     `TRIM_JOB_TOKEN` (**job token (save)**);
   - under **Settings, Deploy Hook**, the **deploy hook (save)**.

The first build starts on its own. It answers 403 on `/api/health` without the proxy secret,
which is correct: only the Pages Function may call it.

## 6. Connect the Pages Function to Render

In the Cloudflare Pages project, **Settings, Variables and Secrets**, for Production:

| Type | Name | Value |
|---|---|---|
| Text | `API_ORIGIN` | the Render URL |
| Secret | `PROXY_SECRET` | the proxy secret |

`web/public/_routes.json` limits the Function to `/api/*`; everything else is served as static
files, and unknown paths fall back to `index.html`. `web/public/_headers` sets the security
headers (task 5.4).

## 7. GitHub settings, then the first deploy

In the repository, **Settings, Secrets and variables, Actions**:

| Kind | Name | Value |
|---|---|---|
| Variable | `APP_URL` | the app URL |
| Variable | `RENDER_API_URL` | the Render URL |
| Variable | `TURNSTILE_SITE_KEY` | the Turnstile site key |
| Variable | `CF_PAGES_PROJECT` | `trim` (the Pages project name) |
| Variable | `BACKUP_AGE_RECIPIENTS` | the backup recipients |
| Secret | `MIGRATION_DATABASE_URL` | the Neon owner URL (direct) |
| Secret | `RENDER_DEPLOY_HOOK` | the deploy hook |
| Secret | `PROXY_SECRET` | the proxy secret |
| Secret | `JOB_TOKEN` | the job token |
| Secret | `CLOUDFLARE_API_TOKEN` | the Cloudflare token |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | the account ID |
| Secret | `BACKUP_DRILL_IDENTITY` | the drill identity |

Then, in the **Actions** tab, run **Deploy**. It runs three jobs:

1. **api:** runs `alembic upgrade head` on Neon, calls the Render deploy hook for this commit,
   and waits until `/api/health` names that commit.
2. **web:** builds `web/`, runs the secret grep on the bundle, and uploads `dist` (with the
   Pages Function) to Cloudflare Pages.
3. **smoke:** `/api/health` answers through the proxy, and the page and the API both send the
   six security headers.

From then on every green CI run on `main` deploys on its own. Optionally, add required
reviewers to the `production` environment so each deploy waits for a click.

Finally, run **Hourly** and **Backup** once from the Actions tab and check they pass.

**Secret grep.** `api/tools/secret_grep.py` fails CI if any tracked file holds a private key, a
cloud or service key, a long value assigned to a secret-looking name, or an `.env` file. On
the built site, it also fails on the name of any server-only setting. A documented test value
can be allowed with a `secret-grep: allow` comment on its line.

## 8. The Safari check (task 1.8 acceptance)

On an iPhone in Safari and on a Mac in Safari, at the app URL:

1. Sign up, open the verification link, and log in with "Keep me signed in".
2. Reload: you stay signed in (the session cookie was stored).
3. Close Safari completely, reopen the site: still signed in.
4. Log out, then log in without "Keep me signed in"; quit Safari and reopen: signed out.
5. In Safari's Web Inspector, Storage, Cookies: `__Host-trim_session` is HttpOnly, Secure,
   SameSite Lax and set by the `pages.dev` host; `__Host-trim_csrf` is not HttpOnly.

When all five pass on both devices, mark 1.8 `[x]` in TASKS.md.

## 9. Streak reminders (task 3.18)

The keys are set in step 5 and `.github/workflows/hourly.yml` calls
`POST /api/internal/jobs/hourly` with `X-Job-Token` every hour, through the Pages proxy.
GitHub may start a scheduled run a few minutes late, and pauses schedules in a public
repository after 60 days without a commit; re-enable **Hourly** in the Actions tab if so.

Check on desktop Chrome, and on an iPhone with TRIM added to the Home Screen (iOS 16.4 or
later): turn on Streak reminder in Account for the coming hour, leave today unlogged, and wait
for the reminder; log something, and check no second reminder arrives that day. When both
pass, mark 3.18 `[x]` in TASKS.md.

## 10. Food pairing table (task 3.22)

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

## 11. Backups and the restore drill (task 5.6)

`.github/workflows/backup.yml` runs every night at 07:17 UTC (and by hand). It has two steps:

1. **Backup.** `ops/backup.sh` dumps Neon (`pg_dump`, custom format, no owners) together with a
   manifest: schema version, exact row counts and the tables with RLS on. It encrypts both with
   age to the two backup recipients and keeps the file as a workflow artifact for 30 days.
2. **Drill.** The same file is downloaded and decrypted with the drill key. `ops/restore-drill.sh`
   then restores it into an empty Postgres and fails unless the schema version, every table's
   row count and RLS all match the manifest.

The repository is public, so anyone signed in to GitHub can download a backup artifact. It is
encrypted, and cannot be read without `owner.key` or `drill.key`. GitHub emails the
repository's admins when a scheduled run fails.

To restore for real:

1. Download the file from the latest **Backup** run's artifacts in the Actions tab, and unzip it.
2. Restore it into an empty database, such as a new Neon branch:
   `TARGET_URL=postgresql://<owner>@<host>/<db> AGE_IDENTITY=owner.key ops/restore-drill.sh backup.tar.age`.
   It creates the roles, restores and checks the result.
3. Point `TRIM_DATABASE_URL` on Render and the `MIGRATION_DATABASE_URL` secret at that database.

The same drill runs in the API tests (`tests/test_backup_drill.py`) against the test database.

## 12. Usage alerts (task 5.7)

Set `TRIM_ALERT_EMAIL` on Render. The hourly job emails it once per period when one of these
reaches 70%. Without an address the alert is only logged.

| Limit | Free tier | Alert at |
|---|---|---|
| Emails today | 100 (Resend's limit; Gmail allows about 500) | 70 |
| Emails this month | 3,000 | 2,100 |
| FoodData Central requests this hour | 1,000 | 700 |
| Neon database size | 0.5 GB | 358 MB |

The counts live in `usage_counters` (per hour, kept 40 days); each alert sent is in
`usage_alerts`. Render, Cloudflare and GitHub have no card on file, so they stop at their
free limits rather than charge; their dashboards show usage.

## Local development

No proxy is needed locally: the Vite dev server forwards `/api` to `http://127.0.0.1:8000`, so
the page and the API already share one origin. Without email settings, emails are written to
`api/.outbox`. The proxy's own tests run with the web tests (`web/edge/proxy.test.ts`),
including a real HTTP server standing in for the API host.
