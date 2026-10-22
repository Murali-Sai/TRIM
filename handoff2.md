# TRIM handoff 2 (22 Oct 2026)

## 1. Goal

Build TRIM (Track, Record, Inspect, Measure), a responsive web app for logging food, weight and body measurements. `SPEC.md` says what to build, `TASKS.md` gives the order and `AGENTS.md` sets the rules.

Standing instructions from the owner:
- Work one task per PR, with conventional commit messages.
- Merge my own PRs once CI is green ("Merge #10 and do the same for all future PRs once they're green").
- Keep building without waiting for a go-ahead.
- Do not merge the Dependabot PRs without asking the owner.
- Use the UI UX Pro Max skill (`.claude/skills/ui-ux-pro-max`) and `design-system/MASTER.md` ("Dark-first data") for front-end work.

Stack:
- **API:** FastAPI, SQLAlchemy `text()` queries under a per-user RLS session, Postgres 16, Alembic (migrations 0001 to 0020).
- **Web:** React, Vite, Tailwind, TanStack Query and uPlot.
- **Tests:** pytest and Playwright (Chromium, plus WebKit for four flows).

## 2. Current state of the code

`main` is at `1baee0a` (merge of PR #49). Every task in all milestones is built and merged. CI on `main` runs these jobs, all green on the last run:
- `api`, `web`, `e2e` (Chromium and WebKit) and `visual`
- `audit` (npm audit and pip-audit)
- `secrets` (secret grep)
- `image` (Docker build, migrate, health check)

Tasks still marked `[~]` in `TASKS.md`. Each one's code is finished; what is missing needs the owner or outside access:

| Task | What it waits on |
|---|---|
| 1.8 Same-origin proxy | Cloudflare, Cloud Run and domain setup, then the Safari cookie check (`docs/DEPLOY.md`). |
| 3.11 Glance test | 3 or more new people. The seed tool `api/tools/seed_glance_month.py` and the script `docs/glance-test.md` are ready. |
| 3.18 Streak reminders | VAPID keys on a deployed server, then a check on desktop Chrome and an iPhone Home Screen install (`docs/DEPLOY.md` step 5). |
| 3.22 Pairing data | Downloading the NHANES and FNDDS files. The container cannot reach wwwn.cdc.gov or www.ars.usda.gov (`docs/DEPLOY.md` step 6). |
| 5.5 Deploy pipeline | GCP, Neon and Cloudflare accounts, plus the secrets and repo variables in `docs/DEPLOY.md` section 7. Then one deploy from `main`. `deploy.yml` skips while `vars.GCP_PROJECT_ID` is empty. |
| 5.8 Device pass | The 20 hand checks in `docs/DEVICE_PASS.md` on real devices, after the site is live. |

Related setup in `docs/DEPLOY.md`:
- **Section 8, backups:** `BACKUP_BUCKET` and the age keys. The backup workflow skips while the bucket is empty.
- **Section 9, usage alerts:** `TRIM_ALERT_EMAIL`.

Open PRs: only Dependabot's #41 to #46. They are left for the owner to decide.

## 3. Files being edited

Nothing is uncommitted. The last session ended after merging #49 and taking screenshots of the UI for the owner. No code edit was in progress.

Local-only files (not committed, recreate as needed):
- `api/.env`: a copy of `api/.env.example` for the local dev database `trim` (gitignored).
- `web/pw-local.config.ts`: runs the Chromium project with the pre-installed browser at `/opt/pw-browsers/chromium`. It is excluded through `.git/info/exclude`.
- Scratchpad helper scripts, all lost with the container:
  - `demo_signup.py` signs up `demo@example.com` without the live Turnstile and breach checks.
  - `shots.mjs` screenshots the main screens at 375 and 1280 px.

How to run things locally:
- **Postgres:** `pg_ctlcluster 16 main start` (port 5433). The dev database is `trim`. Create its roles from `db/init/01-roles.sql`, then run `uv run alembic upgrade head` in `api/`.
- **API tests:** in `api/`, run `TRIM_TEST_OWNER_URL=postgresql+psycopg://trim:trim@127.0.0.1:5433/postgres uv run pytest -p no:warnings -q`.
- **Web e2e:** in `web/`, run `PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test -c pw-local.config.ts`.
- **Visual baselines and WebKit:** run them in `mcr.microsoft.com/playwright:v1.61.1-noble`, started with `docker run --rm --ipc=host -v <repo>:/work -w /work/web -e CI= ...`. Start Docker first with `dockerd`.
- **Demo app:** in `api/`, run `uv run uvicorn app.main:app --port 8000`. In `web/`, run `npx vite --port 5173`; Vite proxies `/api`. Then:
  1. Sign up in-process with a stub human check. A curl sign-up fails because Turnstile must reach challenges.cloudflare.com.
  2. Set `email_verified_at`.
  3. Run `PYTHONPATH=. TRIM_OWNER_URL=postgresql+psycopg://trim:trim@127.0.0.1:5433/trim uv run python tools/seed_glance_month.py demo@example.com`.

## 4. What was tried and failed

Fixed:
- Postgres was down after a container restart. Fix: `pg_ctlcluster 16 main start`.
- Docker Hub returned 429 and ghcr.io was blocked. Fix: the Dockerfile uses `mirror.gcr.io` and installs uv with pip. Local image builds needed a scratch Dockerfile with the proxy CA.
- Alembic's `fileConfig` silenced the app loggers inside the test process. Fix: `disable_existing_loggers=False` in `api/migrations/env.py`.
- The usage-alert tests were skewed by the global hourly job. Fix: they call `usage.check()` directly.
- The restore-drill test hardcoded schema `0019`. Fix: it now matches `\d{4}`.
- The inline theme script broke the strict CSP. Fix: moved it to `web/public/theme-init.js`.
- Visual baselines failed after header changes, and merge conflicts in Progress screenshots. Fix: regenerate the baselines in the pinned Playwright image; never hand-merge PNGs.
- WebKit failures:
  - The import body was sent as a Blob. Fix: `postFileBody` now sends `await file.text()`.
  - The reset flow had a URL race. Fix: the spec polls the URL.
- Ruff S603/S607 on subprocess calls. Fix: `shutil.which` plus `noqa`.

Blocked by the environment, still open:
- A curl sign-up against the dev server returns "Please complete the check and try again". Turnstile needs challenges.cloudflare.com, which the proxy refuses. The workaround is the in-process stub sign-up above.
- 3.22 data download: wwwn.cdc.gov and www.ars.usda.gov are not reachable.

Known flaky tests (each failed once, then passed 3 of 3):
- `web/e2e/edit.spec.ts`: "hovering a card shows delete".
- `web/e2e/today.spec.ts`: "browsing days".

## 5. Next step

Fix the bug found in the UI screenshots: the 1-week calories chart shows every date label twice ("15 Oct, 15 Oct, 16 Oct ...").
- **Cause:** in `web/src/components/chart/DailyBars.tsx`, the x scale is a uPlot time scale. On a wide chart it picks 12-hour tick spacing, and each tick is formatted with `shortDate`, so two ticks fall on each day.
- **Fix:** give the x axis whole-day spacing, either `incrs: [86400, 2 * 86400, 7 * 86400, 14 * 86400, 30 * 86400]` or `splits: () => xs` when there are few bars.
- **Test:** add a unit or e2e test that the 1W labels are unique.
- **Baselines:** regenerate them if the Progress or Calories screenshots change.
- Ship it as one PR from `main`.

After that:
1. Look over the Check-ins and Account screenshots, which were not reviewed.
2. Ask the owner whether to merge the green Dependabot PRs.
3. Help with the `[~]` items once accounts or devices are ready, starting with `docs/DEPLOY.md` section 7.
