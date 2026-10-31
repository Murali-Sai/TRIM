# Recon map: MacroFactor (iOS and Android), compared with TRIM (web)

Scope: the core loop: food logging, weight trend, energy expenditure, targets and weekly check-ins, dashboard.
For: the TRIM owner, as a gap analysis against `SPEC.md`. Nothing here changes SPEC or code.
Date: 2026-10-31

**How this was gathered.** Everything comes from public sources found through web search: MacroFactor's help center, blog, release notes and App Store listing, plus third-party reviews and community posts. This environment cannot open those pages directly or download screenshots. So details come from search summaries, every row is marked with a confidence, and screen states were not observed. Driving the app from the owner's own account would firm this up. No code, assets, wording or private APIs were looked at or taken.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | App Store listing | https://apps.apple.com/us/app/macrofactor-macro-tracker/id1553503471 | pitch, prices (US $11.99 a month, $47.99 for 6 months, $71.99 a year), trial, "Expenditure V3" in the changelog |
| 2 | help: how to log food | https://help.macrofactorapp.com/en/articles/215-how-to-log-food-in-macrofactor | five ways to log: barcode and label scan, search, quick add, AI Describe, custom foods and recipes |
| 3 | blog: timeline food log | https://macrofactor.com/timeline-based-food-logger/ | entries placed on a time-of-day timeline |
| 4 | help: move foods on the timeline | https://help.macrofactorapp.com/en/articles/97-move-foods-to-a-different-time-on-the-timeline | move to a time, today, tomorrow or a chosen date |
| 5 | help: copy and paste | https://help.macrofactorapp.com/en/articles/95-copy-and-paste | copy one food, several, or a whole day |
| 6 | help: log food to future days | https://help.macrofactorapp.com/en/articles/51-log-food-to-future-days | pick a date and time when logging |
| 7 | blog: AI food logging | https://macrofactor.com/ai-food-logging/ | photo, or photo plus text, then an editable plate |
| 8 | blog: fastest food logger | https://macrofactorapp.com/fastest-food-logger/ | their own speed test of 20 loggers (company claim) |
| 9 | help: weight trend | https://help.macrofactorapp.com/dashboard/weight_trend/ | pale scale line, bold trend line; trend lags scale weight |
| 10 | help: adjustments for a goal | https://help.macrofactorapp.com/en/articles/222-how-does-macrofactor-make-adjustments-for-a-weight-gain-or-weight-loss-goal | weekly check-in lowers or raises calories to keep the rate |
| 11 | blog: goal features | https://macrofactor.com/goal-features/ | lose, maintain or gain; target weight and rate; calorie preview and ETA; finish on scale or trend weight |
| 12 | blog: dashboard revamp | https://macrofactor.com/dashboard-revamp/ | dashboard carousel, Energy Balance widget, Strategy page, habits and streaks |
| 13 | blog: Apple Health and Google Fit export | https://macrofactor.com/mm-march-2022/ | nutrition out, weight and body fat in |
| 14 | release notes 2.9.3 | https://macrofactor.com/version-2-9-3/ | two-way sync with Apple Health and Health Connect |
| 15 | Stronger By Science welcome post | https://www.strongerbyscience.com/welcome-to-macrofactor/ | the developer; coached programs recommended |
| 16 | third-party setup guide | https://feastgood.com/?p=41479 | onboarding described as about 33 steps, starting from a standard TDEE formula |
| 17 | third-party migration guide | https://nutrola.app/en/blog/migrating-from-macrofactor-how-to-import-data | Settings, Export Data: CSV bundle by email |
| 18 | blog: Apple Watch | https://macrofactor.com/apple-watch/ | log from custom foods, recipes, favourites and recents on the watch |

## Core loop

Log what you eat and what you weigh, and every week the app re-estimates your real energy expenditure and adjusts your calorie and macro targets to keep you on your goal's rate.

## Screens

States were not observed (no access to the running app). Every row needs a pass in the owner's own account.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Onboarding | first launch | about 33 steps: disclaimer, demographics, goal, diet setup, initial TDEE (src 16) | step forms, goal picker, rate picker, calorie preview with ETA | not observed |
| S02 | Dashboard | home tab | today's calories and macros left, weight, goal progress, habits (src 12) | widget carousel, Energy Balance widget, streak display | not observed |
| S03 | Food log timeline | food tab | the day's foods placed by time (src 3) | timeline rows, time markers, multi-select, copy and move menu | not observed |
| S04 | Food logger | "+" on the timeline | find and add a food (src 2) | search, barcode scan, label scan, AI describe, quick add, custom and recipe entry, favourites and recents | not observed |
| S05 | Food detail and plate editor | tap a result, or after AI | choose amount and serving, edit AI results (src 7) | serving picker, nutrient breakdown with micros | not observed |
| S06 | Weight trend | dashboard or weight tab | scale weight and trend over time (src 9) | pale scale line, bold trend line, ranges | not observed |
| S07 | Expenditure | dashboard | the app's estimate of daily energy burn over time (src 1, 12) | expenditure chart | not observed |
| S08 | Strategy | strategy tab | goal, program style, targets and adjustments in one place (src 12, 15) | goal card, program style (coached, collaborative, manual), macro targets | not observed |
| S09 | Weekly check-in | prompted weekly | review the week and accept new targets (src 10) | summary, old vs new targets | not observed |
| S10 | Insights and data sheet | bottom sheet on a view | streaks and yearly views of nutrition, weight, period tracking (search summary of src 12) | calendar or heatmap views | not observed |
| S11 | Custom food and recipe creator | from the logger | create foods with full nutrients, link a barcode, build recipes (search summaries) | nutrient form, ingredient list | not observed |
| S12 | Settings and integrations | settings | Apple Health and Health Connect sync, data export (src 13, 14, 17) | toggles, export action | not observed |
| S13 | Apple Watch app | watch | quick logging from favourites and recents (src 18) | watch list UI | not observed |

## Flows

Click counts are not known; they need the owner's account. MacroFactor markets speed, so the target to beat is whatever the owner measures.

```
F01 Log a food by search
    S02 -> S03 -> S04 search -> S05 pick serving -> back on S03
    happy path clicks: not measured
    edge: no results, food without a serving size, logging for another day or time

F02 Log a food by barcode, label or photo
    S03 -> S04 scan / photo -> S05 review -> S03
    edge: barcode not in the database, falls back to label scan; AI result needs editing

F03 Weigh in and see the trend
    S02 -> S06
    edge: water-weight jump (the trend absorbs it), missed days

F04 Weekly check-in
    prompt -> S09 review -> accept new targets -> S08 updated
    edge: incomplete logging that week (said to be adherence-neutral), no rate change ("no catch-up")

F05 Set up a goal and program
    S01 (first run) or S08 -> goal type -> target weight -> rate -> program style -> targets
    edge: switching program style keeps the data and the goal

F06 Move or copy foods
    S03 multi-select -> move to time / today / tomorrow / date, or copy, or copy the day

F07 Export data
    S12 -> Export Data -> CSV bundle by email
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Timeline row | food, group | selected, multi-select | S03 |
| Serving picker | units, grams, servings | default, editing | S05 |
| Macro progress (calories, P, C, F) | ring or bar | under, on, over target | S02, S03 |
| Trend chart | weight, expenditure | ranges | S06, S07 |
| Goal and rate picker | lose, maintain, gain | preview with ETA | S01, S08 |
| Program style selector | coached, collaborative, manual | | S08 |
| Bottom sheet | insights, actions | | S03, S10 |
| Scanner | barcode, label | not found, fallback | S04 |

## Inferred data model

```
User           id, demographics (sex, age, height), activity, units
               evidence: S01 onboarding, src 16      confidence: high
Goal           type (lose|maintain|gain), target_weight, rate, finish_on (scale|trend), start
               evidence: src 11                       confidence: high
Program        style (coached|collaborative|manual), calorie and macro targets, effective dates
               evidence: S08, src 15                  confidence: medium
Expenditure    date, estimated_kcal (derived from intake and trend weight)
               evidence: S07, src 1, 10               confidence: medium (method not public)
CheckIn        week, old_targets, new_targets, accepted
               evidence: S09, src 10                  confidence: medium
Food           name, brand, per-serving nutrients incl. micros, barcode, source
               evidence: S04, S11                     confidence: high
Recipe         name, ingredients (food, amount), servings
               evidence: S11, src 2                   confidence: medium
FoodEntry      timestamp, food or recipe, amount, unit, nutrient snapshot (guess)
               evidence: S03, src 3-6                 confidence: high (snapshot is a guess)
WeightEntry    date, scale_weight, body_fat (from scales via Health)
               evidence: S06, src 13                  confidence: high
Habit/Streak   kind, current, longest
               evidence: S02, S10, src 12             confidence: guess on fields
```

Relationships: User 1-n Goal, User 1-n Program, User 1-n FoodEntry, User 1-n WeightEntry, User 1-n Expenditure, User 1-n CheckIn, Recipe n-n Food.

## Feature matrix

See `features.csv`. Must: 14, should: 13, could: 4, of which 3 are skip (not scored). Parity today (TRIM on `main`, through task 3.4): **30 of 100, 4 of 13 must-haves**.

If TRIM finishes every task already in `TASKS.md`, parity rises to about **64 of 100, 9 of 13 must-haves**. Three of the four missing must-haves are things `SPEC.md` excludes on purpose: adaptive expenditure, check-ins that change targets, and barcode scanning. The fourth is a rate picker at goal setup. The `clone` column is TRIM's status on `main` today (through task 3.4), and each note says whether the feature is built, planned in TASKS.md, or excluded by SPEC.md.

## Out of scope (cannot or should not be cloned)

- **Their food database.** It's data they own and curate. TRIM uses USDA FoodData Central and Open Food Facts instead (task 3.2).
- **The expenditure algorithm's exact method.** It isn't public. A clone would need its own published method; the general idea (energy balance from intake and trend weight change) is well known.
- **Native-only features:** the Apple Watch app, plus Apple Health and Health Connect sync (web pages cannot reach HealthKit). TRIM is a website by decision.
- **Their content, wording, icons, colours and look.** Already banned by `AGENTS.md`.

## TRIM features not seen in these sources

Not claimed as missing from MacroFactor (the sources may just not mention them). Listed so the comparison runs both ways:
- the "What should I eat?" optimizer, with food pairing;
- "Fits my macros";
- diet phases;
- water tracking;
- custom body measurements;
- multi-format data export (xlsx, csv, json) and import.

## Size

Screens 13, flows 7, entities 10. Hard parts:
- the adaptive expenditure estimate and the coaching logic (needs its own validated method);
- barcode, label and photo logging (camera, external databases, AI, all excluded by SPEC);
- fast logging UX.

**Size of the gap from TRIM's current plan:** about M if TRIM only finishes its planned tasks. It's L if it also adopts adaptive expenditure and coaching, because that reverses SPEC's "no adaptive TDEE" and "no automatic target change" rules and needs careful, test-vector-driven math.
