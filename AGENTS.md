# AGENTS.md

Instructions for any coding agent working on TRIM (Track, Record, Inspect, Measure).

## Source of truth
- `SPEC.md` defines what to build; `TASKS.md` defines the order. If they conflict, stop and ask.
- Out of scope: barcode scanning, photo logging, any LLM, vision model, Hugging Face model, RAG or agent feature, adaptive TDEE (estimating expenditure from logged data), any automatic target change, sharing between users.
- The TDEE calculator uses Mifflin-St Jeor and the macro rules in SPEC page 3 exactly: 4/4/9 kcal per gram, protein 0.8 g per lb and fat 0.3 g per lb by default; when BMI is 30 or more, protein 0.7 g per lb and fat 25% of calories; carbs fill the rest. Suggested deficit 650 kcal (600 to 700) when BMI is 25 or more, never below the calorie floor. Plans are suggestions the user must accept. Keep one shared set of test vectors for the TypeScript and Python implementations.

## Workflow
1. One milestone at a time, tasks in order. Do not start milestone N+1 until every task in N is `[x]`.
2. Mark a task `[~]` when starting and `[x]` when its acceptance criteria pass, with the commit hash.
3. One task per PR, conventional commit messages.

## Multi-user rules (non-negotiable)
- Every user-owned table has `user_id NOT NULL` and a Postgres RLS policy. Add both in the same migration that creates the table.
- Take `user_id` only from the authenticated session. Never accept it from a request body, query string or path.
- Every new endpoint must be added to the isolation test suite before merge. Another user's IDs return 404, not 403.
- "What should I eat?" uses the deterministic optimizer in SPEC page 3 (scipy.optimize.milp). No AI or LLM, and never exceed the 5% calorie cap. Pairing uses only the `pairing_scores` table built from NHANES, the user's own logs and their `never` pairs.
- Streaks, goals and badges reward logging only. Never add a streak, goal, badge or message that rewards eating less, bigger deficits or faster weight loss, and never use guilt wording.
- Exports read only the requesting user's rows and escape text cells starting with =, +, - or @.
- Never log passwords, tokens, session cookies or full emails. Store only hashes of tokens.

## Tests
- Tests first for all math (EWMA, gaps, outliers, slope, indexed change, rolling averages, unit conversion, TDEE and macro rules, timezone days) using the worked numbers in SPEC page 3.
- External services (FDC, Open Food Facts, Resend) use recorded fixtures or fakes; no live calls in CI.
- Every screen gets Playwright coverage at a phone viewport (375 px) and a desktop viewport (1280 px).

## Security and config
- No API keys or secrets in client code or committed files. All third-party API calls (FDC, Open Food Facts, Resend) go through the backend.
- Send the Open Food Facts User-Agent from config on every request.

## Style
- Mobile-first CSS with Tailwind; test layouts at 375, 768, 1280 and 1920 px.
- TypeScript strict with ESLint and Prettier; Python with ruff and mypy.
- Store kg, cm, grams and mg; convert only for display.
- The Today screen follows the layout in SPEC page 4, but all icons, fonts, colors and copy are original. Never copy assets or text from MacroFactor or any other app.
- Show the TRIM title block (name with "Track, Record, Inspect, Measure" under it) exactly as specified in SPEC page 1, Name and branding.
- Charts use uPlot and the Okabe-Ito palette, each with an `aria-label` summary.
- No em dashes in user-facing copy or docs.

## When unsure
If a claim marked [?] in SPEC matters to your task, verify it against a current source and update SPEC before relying on it.
