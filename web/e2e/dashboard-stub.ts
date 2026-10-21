import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

/** The Progress dashboard on Sat 31 Oct 2026, 4 PM in New York: the fixture month of food,
 * 30 days of weigh-ins drifting down, and a goal of 78 kg. */

interface Day {
  date: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}
export const MONTH = JSON.parse(
  readFileSync(new URL('../../shared/fixture_month.json', import.meta.url), 'utf8'),
) as { days: Day[]; targets: Record<string, unknown>[] };

export const NOW = new Date('2026-10-31T20:00:00Z');
const SWING = [0.3, -0.2, 0.1, -0.3, 0.2, 0, -0.1, 0.25, -0.15, 0.05];

export const WEIGHTS = Array.from({ length: 30 }, (_, i) => {
  const day = `2026-10-${String(i + 2).padStart(2, '0')}`;
  return {
    id: `w${i}`,
    measured_at: `${day}T11:00:00Z`,
    day,
    kg: Math.round((80.6 - i * 0.035 + (SWING[i % SWING.length] ?? 0)) * 10) / 10,
    note: null,
  };
});

/** A 23-day streak with 1 freeze; two of this week's three goals done. */
export const STREAKS = {
  today: '2026-10-31',
  current_days: 23,
  longest_days: 23,
  freezes_held: 1,
  today_logged: true,
  message: null,
  weigh_in: { current_weeks: 4, longest_weeks: 4, this_week: 2 },
  month: '2026-10',
  calendar: Array.from({ length: 31 }, (_, i) => {
    const date = `2026-10-${String(i + 1).padStart(2, '0')}`;
    return { date, state: i < 8 ? 'none' : i === 19 ? 'freeze' : 'logged' };
  }),
};
export const GOALS = {
  week_start: '2026-10-26',
  goals: [
    { kind: 'log_food', text: 'Log food on 5 of 7 days', done: 5, needed: 5, complete: true },
    {
      kind: 'protein',
      text: 'Protein at 95% of target or more on 4 days',
      done: 4,
      needed: 4,
      complete: true,
    },
    { kind: 'weigh_in', text: 'Weigh in 3 times', done: 2, needed: 3, complete: false },
  ],
  perfect: false,
  perfect_weeks: 2,
};

export async function openDashboard(page: Page, opts: { metric?: boolean } = {}) {
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, { ...ME, unit_system: opts.metric ? 'metric' : 'imperial' });
  await page.route('**/api/targets', (r) =>
    r.fulfill({
      json: MONTH.targets.map((t) => ({
        ...t,
        fiber_g: null,
        water_ml: null,
        source: 'custom',
        bmr: null,
        tdee: null,
        formula: null,
      })),
    }),
  );
  await page.route('**/api/logs/days**', (r) => {
    const url = new URL(r.request().url());
    const from = url.searchParams.get('date_from') ?? '';
    const to = url.searchParams.get('date_to') ?? '';
    return r.fulfill({ json: MONTH.days.filter((d) => d.date >= from && d.date <= to) });
  });
  const today = MONTH.days.find((d) => d.date === '2026-10-31');
  await page.route(
    (url) => url.pathname === '/api/logs',
    (r) =>
      r.fulfill({
        json: today
          ? [
              {
                id: 'e1',
                log_group_id: 'g1',
                food_id: null,
                eaten_at: '2026-10-31T17:00:00Z',
                logged_on: '2026-10-31',
                name: 'Day so far',
                brand: null,
                grams: null,
                quantity: null,
                unit_label: null,
                kcal: today.kcal,
                protein_g: today.protein_g,
                carbs_g: today.carbs_g,
                fat_g: today.fat_g,
                fiber_g: 20,
                sugar_g: null,
                sodium_mg: null,
                source: 'quick_add',
                saved_meal_id: null,
                meal_name: null,
              },
            ]
          : [],
      }),
  );
  await page.route('**/api/weights', (r) => r.fulfill({ json: WEIGHTS }));
  await page.route('**/api/me/settings', (r) =>
    r.fulfill({
      json: { track_water: false, track_fiber: true, water_unit: 'ml', gamification: true },
    }),
  );
  await page.route('**/api/streaks**', (r) => r.fulfill({ json: STREAKS }));
  await page.route('**/api/goals', (r) => r.fulfill({ json: GOALS }));
  await page.route('**/api/me/body-stats', (r) =>
    r.fulfill({
      json: {
        sex: 'male',
        age: 41,
        height_cm: 178,
        activity_level: 'light',
        unit_system: opts.metric ? 'metric' : 'imperial',
        latest_weight_kg: WEIGHTS.at(-1)?.kg ?? null,
        goal_weight_kg: 78,
      },
    }),
  );
  await page.goto('/charts');
}
