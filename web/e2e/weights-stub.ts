import type { Page } from '@playwright/test';
import { ME } from './fixtures';

export interface Entry {
  id: string;
  measured_at: string;
  day: string;
  kg: number;
  note: string | null;
}

/** An in-memory /api/weights, so the page runs against something that behaves like the API. */
export async function stubWeights(page: Page, initial: Entry[] = [], goalKg: number | null = null) {
  const live = [...initial];
  const state = { goal: goalKg };
  const deleted = new Map<string, Entry>();
  let next = 1;
  const sorted = () => [...live].sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  const dayOf = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: ME.timezone }).format(new Date(iso));

  await page.route('**/api/me/body-stats', (route) =>
    route.fulfill({
      json: {
        sex: 'male',
        age: 30,
        height_cm: 180,
        activity_level: 'moderate',
        unit_system: ME.unit_system,
        latest_weight_kg: sorted().at(-1)?.kg ?? null,
        goal_weight_kg: state.goal,
      },
    }),
  );
  await page.route('**/api/me/goal-weight', (route) => {
    state.goal = (
      route.request().postDataJSON() as { goal_weight_kg: number | null }
    ).goal_weight_kg;
    return route.fulfill({ json: { goal_weight_kg: state.goal } });
  });
  await page.route('**/api/weights**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const id = path.split('/')[3];
    if (req.method() === 'GET') return route.fulfill({ json: sorted() });
    if (req.method() === 'POST' && path === '/api/weights') {
      const body = req.postDataJSON() as { kg: number; measured_at?: string; note?: string };
      const at = body.measured_at ?? new Date().toISOString();
      const entry = {
        id: `w${next++}`,
        measured_at: at,
        day: dayOf(at),
        kg: body.kg,
        note: body.note ?? null,
      };
      live.push(entry);
      return route.fulfill({ status: 201, json: entry });
    }
    if (req.method() === 'POST' && path.endsWith('/restore')) {
      const entry = deleted.get(id ?? '');
      if (!entry) return route.fulfill({ status: 404, json: { detail: 'Not found' } });
      deleted.delete(entry.id);
      live.push(entry);
      return route.fulfill({ json: entry });
    }
    const index = live.findIndex((e) => e.id === id);
    if (index < 0) return route.fulfill({ status: 404, json: { detail: 'Not found' } });
    const entry = live[index] as Entry;
    if (req.method() === 'DELETE') {
      live.splice(index, 1);
      deleted.set(entry.id, entry);
      return route.fulfill({ status: 204, body: '' });
    }
    const patch = req.postDataJSON() as Partial<Entry>;
    Object.assign(entry, patch);
    entry.day = dayOf(entry.measured_at);
    return route.fulfill({ json: entry });
  });
  return { live, state };
}
