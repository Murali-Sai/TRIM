# TRIM handoff 3 (22 Oct 2026)

## Where we are

All code is built and merged. The owner is now setting up the free hosting by hand, following
`docs/DEPLOY.md` ("Deploying TRIM for $0"). Resume with them at **Neon step 1 below**.

Owner decisions this session:
- **Spend nothing** on cloud or APIs, and no card on file anywhere. So: Render free (API),
  Cloudflare Pages on `pages.dev` (no custom domain), Neon Free, Gmail SMTP with an app
  password (email), GitHub Actions for the hourly job and backups.
- **Email:** Gmail app password.
- **Backups:** age-encrypted GitHub Actions artifacts, kept 30 days.

Merged this session:
- #51: 1W chart dates no longer repeat (ticks sit on bars, `web/src/lib/chart/ticks.ts`).
- #52: `SmtpSender` and `TRIM_SMTP_*` settings; prod accepts Resend or SMTP.
- #53: $0 deploy. `render.yaml`, new `deploy.yml` (migrate, then Render deploy hook, then wait
  for `/api/health` to name the commit, then Pages, then smoke check), `hourly.yml`, backups as
  artifacts, `ops/alerts.sh` removed, DEPLOY/SPEC/TASKS updated.
- #54 (open at handoff, merge when green): `/healthz` outside `/api` for Render's health check;
  `/api/health` answers 403 without the proxy secret.

## Owner's progress on docs/DEPLOY.md

Step 1, Neon:
- Done: project `TRIM`, region AWS US East 2 (Ohio), branch `production`, database `TRIMdb`,
  owner role `TRIMdb_owner`. Roles `trim_app` (NOLOGIN) and `trim_api` (LOGIN, IN ROLE
  trim_app) created by SQL and checked: neither has BYPASSRLS.
- **Next:** copy two strings from Connect into their notes, both starting
  `postgresql+psycopg://`:
  - **Owner URL:** `TRIMdb_owner`, pooling off (no `-pooler`), goes to the GitHub secret
    `MIGRATION_DATABASE_URL`.
  - **App URL:** take the pooled string and swap in `trim_api:<its password>` (SQL-made roles
    do not show in Neon's Roles page or Connect picker). Goes to Render `TRIM_DATABASE_URL`.

Still to do: step 2 Gmail app password, step 3 data.gov key + VAPID keys + age keys (the owner
seems to be on Windows: offer Git Bash for the OpenSSL command, or a browser-console WebCrypto
version, and the age Windows zip), step 4 Cloudflare, step 5 Render Blueprint, step 6 Pages
variables, step 7 GitHub variables and secrets then run Deploy, Hourly and Backup.

## Follow-ups for the agent

- Neon Free now shows 1 GB storage; `api/app/usage.py` still alerts at 70% of 512 MB. Update
  the limit and SPEC page 5 in a small PR.
- Unverified claims marked [?] in SPEC page 5: Render free needs no card and gives 750 hours;
  Render deploy hooks accept `&ref=<sha>`; Gmail allows about 500 recipients a day. The first
  real deploy checks them.
- Still blocked here: NHANES/FNDDS downloads for 3.22 (wwwn.cdc.gov, www.ars.usda.gov refused
  by the proxy).
- Dependabot PRs #41 to #46: owner's call.

## Local setup in this container (lost on restart)

- Postgres 16 runs on port **5432** here (not 5433). Roles made by hand:
  `CREATE ROLE trim LOGIN SUPERUSER PASSWORD 'trim'` plus `db/init/01-roles.sql`.
- API tests: in `api/`,
  `TRIM_TEST_OWNER_URL=postgresql+psycopg://trim:trim@127.0.0.1:5432/postgres uv run pytest -q -p no:warnings`.
- Visual and WebKit: `dockerd` in the background, then
  `docker run --rm --ipc=host -v $PWD:/work -w /work/web -e CI= mcr.microsoft.com/playwright:v1.61.1-noble npx playwright test -c playwright.visual.config.ts`.
