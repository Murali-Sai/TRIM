# Glance test (task 3.11)

SPEC page 4, "How intuitiveness is measured": at least 3 people who have never seen TRIM each
answer five questions from the Progress dashboard on a phone, with a seeded month of data.
Pass mark: **at least 13 of 15 answers correct, each within 5 seconds.** Any card that fails is
redesigned and the test is run again with new people.

## Before the session

1. Make one fresh account per person (or one shared account, reset between people). Sign up,
   verify the email and finish setup, so the app opens on Today.
2. Seed it from `api/`:

   ```
   TRIM_OWNER_URL=postgresql+psycopg://... uv run python tools/seed_glance_month.py EMAIL
   ```

   The tool refuses an account that already has food logs or weigh-ins. It writes 30 days of
   calories and macros (with four days not logged and some right on the 5% edges), 30 daily
   weigh-ins drifting down, a 2,200 kcal target and a 78 kg goal. Days are relative to the
   account's own today. It prints the **answer key**; keep it out of sight.
3. Sign in on a phone (an iPhone or Android at its normal text size), open **Charts**, and
   lock the screen so it opens straight on the dashboard.

## During the session

Say only: "I will ask five questions about this person's food and weight. Answer from the
screen as quickly as you can. There are no wrong answers about you; we are testing the app."

Show the phone, start a stopwatch on each question as you finish reading it, stop it at the
first answer. Do not help, point or scroll for them (they may scroll).

| # | Question | Card that should answer it |
|---|---|---|
| 1 | How many calories are left today? | Today |
| 2 | Am I on track for protein this week? | Macros this week |
| 3 | Is my weight going up or down, and how fast? | Weight |
| 4 | How many days this week was I on target? | Calories this week |
| 5 | How much has my waist changed since I started? | Body measurements |

Question 5 needs measurements (task 4.1). Until then, ask questions 1 to 4 and score out of 12;
the pass mark scales to at least 11 of 12 (13 of 15 is 87%). Run the full test again once 4.1
ships.

## Scoring sheet

An answer counts when it matches the key (calories within 10, rate to one decimal, direction
right) **and** comes within 5 seconds.

| Person | Q1 | Q2 | Q3 | Q4 | Q5 | Correct in time |
|---|---|---|---|---|---|---|
| A | | | | | | |
| B | | | | | | |
| C | | | | | | |
| **Total** | | | | | | **of 15** |

For each miss, note what the person looked at and what they said. That is the redesign brief.

## After the session

- Pass: mark 3.11 `[x]` in TASKS.md with the date and the score.
- Fail: redesign each card with a miss (headline wording first, then the visual), then rerun
  with new people. Record both rounds here.

## Results

No sessions run yet.
