# TRIM handoff (20 Oct 2026)

## 1. Goal

Build TRIM (Track, Record, Inspect, Measure), a responsive web app for logging food and weight, from `SPEC.md`, task by task in the order of `TASKS.md`, following `AGENTS.md`.

Standing instructions from the owner:
- Work tasks in order, one task per PR, with conventional commit messages.
- Report back only when something needs a decision.
- The owner has handed all git decisions to the agent.

Stack: FastAPI, Postgres 16 with row-level security, and Alembic under `api/`. React, Vite, Tailwind, TanStack Query and uPlot under `web/`.

## 2. Current state

**Milestone 1**
- Done except 1.8 (`[~]`), which waits on the owner's Cloudflare, Cloud Run and domain setup and the Safari checklist in `docs/DEPLOY.md`.
- The owner approved starting Milestone 2 with 1.8 still open.

**Milestone 2**: complete. **Milestone 3**: 3.1 and 3.2 done.

**Merged into `main`**: PR #1 (1.9 isolation harness and 2.1 trend math).

**Open PRs**, each stacked on the one above. Merge in order; GitHub then moves each next PR onto `main`.

| PR | Branch | Base | Task | CI |
|---|---|---|---|---|
| #2 | `task/2.2-weight-log` | `main` | 2.2 weight CRUD and quick entry | green |
| #3 | `task/2.3-weight-chart` | #2 | 2.3 uPlot weight chart and goal weight | green |
| #4 | `task/2.4-goal-projection` | #3 | 2.4 goal-date projection | green |
| #5 | `task/3.1-food-schema` | #4 | 3.1 foods, serving units, food logs schema and RLS | green |
| #6 | `task/3.2-food-search` | #5 | 3.2 food search waterfall | running at handoff |

- `TASKS.md` on each branch marks its task `[x]` with the commit hash.
- This session is subscribed to all five PRs.
- A safety-net check-in (`trig_01UoVBBmYcPVpWEYzsegaSaz`) fires at 15:48 UTC.

**What exists now**

API:
- Auth, account and setup endpoints.
- `/api/weights` CRUD and restore.
- `PUT /api/me/goal-weight`.
- `GET /api/foods/search` with the waterfall.

Migrations: 0001 to 0005.
- 0004: `foods`, `serving_units` and `food_logs`, with RLS.
- 0005: `foods.kcal_mismatch`, the `cache_food()` function, and the `food_queries` table with its `food_query_*` functions.

Web:
- Body page: trend sentence, projection sentence, quick entry, goal weight, weigh-in list.
- Lazy-loaded weight chart.

Shared test vectors:
- `shared/tdee_vectors.json`
- `shared/trend_vectors.json` (trend, weekly rate and projection)

Test counts at the end of the session (full suites, on the 2.4 branch):
- 155 vitest
- 189 Playwright
- API pytest all green; 3.2 adds 31 tests

## 3. Files being actively edited

There are no uncommitted changes. Every branch is pushed and its working tree is clean.

The most recent work, on `task/3.2-food-search`:
- `api/app/routers/foods.py`: the search waterfall.
- `api/app/services/fooddata.py`: FDC and OFF clients and parsers.
- `api/migrations/versions/0005_food_cache_writes.py`
- `api/tests/test_food_search.py` and `api/tests/fixtures/*.json`
- `api/tests/fakes.py`: `FakeFoodSource`.
- `api/tests/conftest.py`: clears the food cache and `food_queries` per test.
- `api/tests/isolation/registry.py` and `harness.py`: new `params` field; A's food ids are now secrets.
- `api/tools/record_food_fixtures.py`

Not in git: `web/pw-local.config.ts`, listed in `.git/info/exclude` (see section 4).

## 4. What failed, and what to do instead

**Git, GitHub and environment**
- **Merging PRs myself.** I merged PR #1 through the GitHub tool. Auto mode then blocked the next git command as "Merge Without Review". Don't self-merge: open PRs and let the owner merge. Because only one branch can be merged at a time, each task gets its own `task/x.y-*` branch, stacked on the previous one.
- **CI on `main-yttrje`.** CI only runs on pushes to `main` and on pull requests, so a pushed branch shows no runs. Open a PR to get CI.
- **External APIs.** FDC (`api.nal.usda.gov`) and Open Food Facts are blocked by this environment's proxy (403 on CONNECT). WebFetch can't resolve `fdc.nal.usda.gov` or `openfoodfacts.github.io` either. WebSearch works, and that's how I verified the OFF limits.
  - The 3.2 fixtures are therefore hand-written in each API's documented shape.
  - Re-record them with `api/tools/record_food_fixtures.py` once a key and network access are available.
  - That run should also confirm the FDC nutrient ids (1008, 2047, 2048, 1003, 1004, 1005, 1079, 2000, 1093).
- **Playwright's own browser.** It wants `chromium_headless_shell-1228`, which isn't installed. Use the local config instead:
  `PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test -c pw-local.config.ts`
  That config sets `launchOptions.executablePath`. Recreate it if it's missing:
  ```ts
  import base from './playwright.config';
  import { defineConfig } from '@playwright/test';
  const projects = (base.projects ?? []).map((p) => ({ ...p, use: { ...p.use, launchOptions: { executablePath: process.env.PW_CHROMIUM } } }));
  export default defineConfig({ ...base, projects });
  ```
- **Postgres after a container restart.** It is down and the API tests fail with "connection refused". The cluster is already on port 5433 with the `trim` superuser (password `trim`). Fix: `pg_ctlcluster 16 main start`. On a fresh container instead:
  1. `sed -i 's/^port = 5432/port = 5433/' /etc/postgresql/16/main/postgresql.conf`
  2. Start the cluster.
  3. `su postgres -c "psql -p 5433 -c \"CREATE ROLE trim SUPERUSER LOGIN PASSWORD 'trim'\""`

**Code dead ends (each already fixed)**
- **Route discovery.** FastAPI 0.143 wraps included routers, so `app.routes` held no `APIRoute`s. The harness now walks `effective_route_contexts`.
- **uPlot in unit tests.** Importing uPlot crashes jsdom (`matchMedia`), so `WeightChart` is lazy-loaded.
- **Render timing.** Timing straight after `new uPlot()` undercounted, because uPlot draws in a microtask. The time is now recorded in the first `draw` hook.
- **Tap test.** A tooltip tap test failed because the chart was below the fold at 375 px. The test now calls `scrollIntoViewIfNeeded` first.
- **Shared e2e stub.** One spec importing another is refused by Playwright. The stub moved to `e2e/weights-stub.ts`.
- **Swing band.** The band looked missing; the goal line stretches the y-axis, so the band is just thin. Not a bug.
- **Python rounding.** `round()` rounds halves to even and disagreed with JS `Math.round`. It's now `floor(x + 0.5)`, and a half-day vector pins it.
- **Trigram index.** A raw-SQL `pg_trgm` index made `alembic check` report drift, so it was dropped. ILIKE is enough for now.
- **FDC re-queries.** "Call FDC when under 10 results" alone would re-query FDC forever for small result sets. Added `food_queries`, so each source is asked once per query in 30 days.
- **Test isolation.** The shared food cache carried over between tests. The `client` fixture now clears it.
- **Clock-based tests.** Advancing the fake clock 31 days expired the session; that test now ages `food_queries` rows instead. A helper that aged rows using the real date plus an offset was brittle and now uses the fake clock.
- **Sign-up bug.** `/api/me` sent a user back to sign-up after they deleted every weigh-in. Fixed in #2: once targets exist, setup counts as done.
- **e2e expectations.** These assumed the trend equals the readings, but the EWMA lags them. Tests now compute the expected values from the same library.

## 5. Next step

1. **Watch PR #6's CI.** If it's red, fix it on `task/3.2-food-search` and push.
2. **Get the stack merged.** Ask the owner to merge #2 to #6 in order. When a base PR merges, merge the new base into the next branch if GitHub reports a conflict. Never force-push.
3. **Start task 3.3** (targets editor and TDEE calculator page) on a new branch `task/3.3-targets-editor`. Base it on `task/3.2-food-search`, or on `main` if the stack is merged by then.
   - **Spec**: read `SPEC.md` page 3, "Energy, TDEE and macro rules", and page 4, "Sign-up flow and TDEE calculator" and "TDEE calculator page".
   - **Features**: custom edits, "Reset to formula", recalculate from the latest trend weight, a confirmation showing old and new values, and a TDEE table for all five activity levels.
   - **AC**: editing calories recalculates only carbs. Targets never change unless the user taps "Use these targets" or saves an edit.
   - **Building blocks**:
     - The TS and Python TDEE math (`web/src/lib/tdee.ts`, `api/app/tdee.py`) with its shared vectors.
     - The latest trend weight: `trendFor` and `computeTrend`.
     - The `/api/targets` and `/api/targets/apply-calculation` endpoints.
   - **Isolation**: every new endpoint goes into `api/tests/isolation/registry.py`.
