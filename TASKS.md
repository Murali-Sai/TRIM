# TASKS.md

Status: `[ ]` todo, `[~]` in progress, `[x]` done. A task is checked only when its acceptance criteria (AC) pass.

## Milestone 1: Accounts and responsive shell
- [x] **1.1 Scaffold**: `web/` (Vite, React, TS, Tailwind, TanStack Query), `api/` (FastAPI, SQLAlchemy, Alembic), CI running lint, typecheck and tests. AC: CI green on empty suites. (cb6ddea)
- [x] **1.2 Responsive app shell**: bottom tabs under 1024 px, sidebar at 1024 px and up, dark mode, safe-area CSS, 16 px inputs. AC: screenshots at 375, 768, 1280, 1920 show no horizontal scroll. (cfb488b)
- [x] **1.2b TRIM title block**: "TRIM" with "Track, Record, Inspect, Measure" under it on landing, auth pages, desktop sidebar, phone header and emails; page titles and manifest names. AC: visible and unwrapped at 360, 768, 1280 and 1920 px in light and dark mode; contrast passes AA. (d8d8851, 3177242)
- [x] **1.3 users, user_profiles, sessions, auth_tokens, audit_log tables + RLS**. AC: RLS test with wrong `app.user_id` returns zero rows. (b2e9b96)
- [x] **1.4 Sign up and email verification (Resend, Turnstile)**. AC: verify link works once and expires after 1 hour. Open sign-up. `/auth/resend-verify` needs a session, so it ships with 1.5. (542efec)
- [x] **1.5 Login, logout, sessions, CSRF, lockout**. AC: 6th failed attempt in 15 min is locked; write without CSRF header returns 403. Includes `/auth/resend-verify`, `/me` and the 7-day verification grace. (fe674e1)
- [x] **1.6 Forgot and reset password**. AC: reset revokes all sessions. (e5f5fb8)
- [x] **1.6b Body-stats step and targets step in sign-up**: unit toggle, age, sex, weight, height, activity dropdown; result card with TDEE, weekly total, BMR and macro bars. Includes the Lose / Maintain plan choice with the suggested plan preselected by BMI, deficit chips and the pace estimate. AC: the three worked examples in SPEC page 3 show exactly those targets; first weight entry created. Created the `weight_entries` and `targets` tables early (with RLS), so 2.2 and 3.1 build on them. The result card's "Adjust" button arrives with the Targets editor in 3.3; the measurement presets step (step 4) with 4.1. (95740d1)
- [x] **1.6c TDEE and macro rules module (tests first)** (built before 1.6b, which needs it) (a9d2c84), same test vectors in TypeScript and Python. AC: all SPEC examples, BMI boundaries 24.9/25.0/29.9/30.0, 0.7 g/lb and 25%-fat rules above BMI 30, calorie floor, imperial conversion, carbs clamp at 0, input ranges.
- [x] **1.7 Account page**: profile, units, timezone, change password, session list, delete account. AC: deleted user cannot log in; their rows are gone. "Download my data" joins this page in 5.1. (d87444f)
- [~] **1.8 Same-origin proxy (Pages Function to Cloud Run)**. AC: session cookie works in iPhone Safari and desktop Safari. Proxy, shared-secret guard and tests done; waiting on the Cloudflare, Cloud Run and domain setup and the Safari check in docs/DEPLOY.md. Milestone 2 started with 1.8 still open, at the owner's request (19 Oct 2026).
- [x] **1.9 Isolation test harness** that runs against every endpoint. AC: fails the build if any endpoint lets user B touch user A's data. (9cd9026)

## Milestone 2: Weight logging and trend chart
- [x] **2.1 Trend math (tests first)**: EWMA, gap alpha, outliers, min points, weekly slope. AC: SPEC page 3 examples match to 0.01. (2f75013)
- [x] **2.2 Weight CRUD + quick entry**. AC: entry under 3 s on phone; isolation suite covers it. (1eb17c6)
- [x] **2.3 Weight chart (uPlot)**: dots, trend, goal, band, ranges, tap and hover tooltips, pinch and wheel zoom. AC: 365 points render under 300 ms. (201c812)
- [x] **2.4 Goal-date projection**: dotted line and sentence, hide rules. AC: trend 79.8, goal 75.0, rate -0.45 kg/week from 17 Oct 2026 shows "around 31 Dec 2026"; flat or wrong-direction trend shows the no-projection message. (13e0fc4)

## Milestone 3: Food logging, dashboard, charts
- [x] **3.1 foods, serving_units, food_logs, targets schema**. AC: migrations up and down. (853c69e)
- [x] **3.2 Search waterfall (personal, cache, FDC, OFF)**. AC: recorded-fixture tests per tier. (978c78a; fixtures hand-written in the documented shapes until they can be re-recorded with api/tools/record_food_fixtures.py)
- [x] **3.3 Targets editor and TDEE calculator page**: custom edits, "Reset to formula", recalculate with latest trend weight, old vs new confirmation, TDEE table for all five levels. AC: editing calories recalculates carbs only; targets never change without the user tapping "Use these targets" or saving an edit. The calculator card on the Progress dashboard arrives with 3.10; until then the calculator opens from Targets and Account. (5a80c14)
- [x] **3.4 Time-based logging**: `eaten_at` on food_logs, time chip with Now, -30 min, -1 h and last-used, backdating to past days. AC: food logged at 19:00 for 16:00 lands in the 4 PM block and on the correct local date. Includes the Log food screen (search, amounts, several foods per add); the timeline that shows the blocks is 3.5. (a2c276a)
- [x] **3.5 Today timeline**: target strip with paging, time blocks with pill, "+" and subtotal chips, entry cards, empty state. AC: the reference fixture day (6 items at 4:00 PM) shows 1774 kcal, 148 P, 44 F, 193 C at 375 px and 1280 px. The reference day is shared/reference_day.json. Entry edit buttons arrive with the edit sheet in 3.6; the water row with 3.13. (01dd6b0)
- [x] **3.6 Edit, move and copy**: edit sheet or panel, change time, multi-select move, copy a time block to another day, desktop drag between blocks. AC: moving a card updates both blocks' subtotals. (ba819f6)
- [ ] **3.7 Fast paths**: recents, frequents, favourites, quick-add, custom foods. AC: logging a recent food under 5 s.
- [ ] **3.7b Saved meals**: create from scratch, from a time block and from a selection; Meals tab; one-tap log; sheet with time, 0.5x to 2x and custom portions, skip and per-item edits; "Update meal?" prompt; archive; undo whole meal; isolation tests. AC: the "Post-workout lunch" example logs 1,345 kcal at 1x and 2,018 kcal at 1.5x; editing the meal leaves past logs unchanged; one-tap log under 3 s on phone.
- [ ] **3.8 Chart kit**: headline sentence builder, direct line labels, target line and band, sentence tooltips, "View as table", too-little-data messages. AC: unit tests for every headline template with fixture numbers.
- [ ] **3.9 Calorie and macro charts + adherence**: bars with on-target band, 7-day average, per-macro small charts, calorie split bars. AC: adherence equals hand count on fixture month; calorie and macro axes start at zero.
- [ ] **3.10 Progress dashboard**: seven cards including this week's check-in (phone column, desktop three-column grid), tap to open full chart. AC: visual regression at 375 and 1280 px.
- [ ] **3.11 Glance test**: 3 or more new users, 5 questions, seeded month. AC: at least 13 of 15 correct within 5 s; failing cards redesigned and retested.
- [ ] **3.12 Timezone-correct days**. AC: tests for users in UTC-5 and UTC+9 at 23:30 local.
- [ ] **3.13 Water and fiber**: settings toggles, water row with +250/+500 ml, fiber target default 14 g per 1,000 kcal, "fiber unknown" count. AC: 2,759 kcal gives 39 g fiber; fl oz conversion test.
- [ ] **3.14 Fits my macros**: candidate set, fit score, labels, "fits up to N g". AC: worked example ranks chicken 0.60, yogurt 0.35, peanut butter 0.28, rice 0.27.

- [ ] **3.15 Streak engine (tests first)**: logging streak, repair window, freezes, weekly weigh-in streak, lazy evaluation, streak_events. AC: the 13-day example in SPEC page 3 plays out exactly; a day over target still counts; timezone and DST tests pass.
- [ ] **3.16 Weekly goals and badges**: Monday goal selection from tracked features only, progress rings, Perfect week, badge awards. AC: a user not tracking water never gets the water goal; each badge awarded once.
- [ ] **3.17 Streak UI**: header flame, first-log animation, milestone card, streak sheet, badges page, Progress card, off switch. AC: reduced-motion skips animations; off hides every element at 375 and 1280 px.
- [ ] **3.18 Streak reminders (Web Push)**: opt-in, VAPID, subscription storage, hourly job sends at most one a day only if today is unlogged. AC: works on desktop Chrome and on an iPhone Home Screen install; no reminder after the day is logged.

- [ ] **3.19 Staples**: table with 20-per-user limit, CRUD, reorder, availability, unit and amount rules, "add your 10 most-logged foods" prompt after 14 days. AC: the 21st staple is rejected; countable units default to 1 to 4 in steps of 1.
- [ ] **3.20 Suggestion engine (tests first)**: MILP with scipy.optimize.milp, budget modes, max items, 5% kcal cap, three distinct sets, Shuffle. AC: SPEC worked example returns the same three combinations and match % (97.5, 97.2, 97.0); 20 staples solve under 300 ms.
- [ ] **3.21 Suggestion UI**: button on Today and Log food, sheet with chips and three cards, Log at time, Save as meal, Shuffle, empty states. AC: logging a suggestion creates one time block with source `suggestion`; works at 375 and 1280 px.

- [ ] **3.22 Pairing data build**: `tools/build_pairing.py` reads NHANES Individual Foods files, maps food codes to WWEIA categories and the 23 groups, computes lift and score per context, writes a CSV loaded into `pairing_scores`. AC: fixture test values match hand calculations; pairs under 30 plates score 0; the real table is committed with its data version.
- [ ] **3.23 Pairing in suggestions**: staple food groups (auto-guessed, editable), context chip, forbidden pairs, good-pair bonus, personal history override, thumbs-down `never` pairs, pairing label, lock and Shuffle. AC: SPEC worked example returns the three dinner combinations with fixture scores; locked items always appear; Shuffle never repeats a set.

## Milestone 4: Custom measurements and diet phases
- [ ] **4.1 Types and entries; presets copied per user at sign-up**. AC: renaming one user's preset does not affect another.
- [ ] **4.2 Manage metrics UI (create, rename, reorder, enable, archive)**. AC: archived history still exports.
- [ ] **4.3 Quick-log, per-metric chart, L/R pairs, overlay, small multiples, baseline table**. AC: indexed change test (90.0 to 87.3 gives -3.0%).
- [ ] **4.4 E2E: create metric and chart it on phone and desktop viewports**. AC: Playwright passes.
- [ ] **4.5 Diet phases**: create, edit, delete, no overlaps, chart tints with toggle, phase summaries, optional explicit "Also update targets". AC: overlapping phase rejected; targets unchanged unless the button is pressed.

## Milestone 5: Check-ins, data download, hardening, deploy
- [ ] **5.1 Download my data**: format (xlsx, csv zip, json), date range, dataset picker; streamed; formula-injection escaping; audit row; 1 per minute limit. AC: seeded account export opened with openpyxl matches expected cells, types and units; a food named "=SUM(A1)" exports as text.
- [ ] **5.2 JSON import**. AC: export then import into an empty account gives identical counts and checksums.
- [ ] **5.3 Weekly check-ins**: scheduler job, generation in user timezone, in-app list and Progress card, optional email queued at 90 a day. AC: check-ins generate correctly for users in UTC-5, UTC+0 and UTC+9, including a DST change week; under-4-days message shown.
- [ ] **5.4 Security headers (HSTS, CSP), dependency scanning**. AC: securityheaders-style check passes in CI.
- [ ] **5.5 Deploy pipeline (Pages, Cloud Run, Neon, secrets)**. AC: main deploys automatically; secret grep passes.
- [ ] **5.6 Nightly encrypted backup + restore drill**. AC: restore into scratch DB succeeds.
- [ ] **5.7 Usage alerts at 70% of each free tier**. AC: test alert fires.
- [ ] **5.8 Device pass**: iPhone Safari, Android Chrome, desktop Chrome, Safari, Firefox. AC: checklist complete.
