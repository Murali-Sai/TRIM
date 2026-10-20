import ref from '../../../shared/reference_day.json';
import type { LogEntry } from '../api/logs';
import { draftFrom, patchFor, previewFor, readDraft } from './logEdit';

const NY = 'America/New_York';
const [chicken, rice] = ref.entries as LogEntry[]; // 350 g; 2 x "1 cup" = 400 g

describe('edit draft', () => {
  test('starts from the entry, in the user timezone', () => {
    expect(draftFrom(chicken as LogEntry, NY)).toEqual({
      amount: '350',
      unit: 'g',
      date: '2026-10-17',
      time: '16:00',
    });
    expect(draftFrom(rice as LogEntry, NY)).toMatchObject({ amount: '2', unit: '1 cup' });
  });

  test('unchanged draft sends nothing', () => {
    const d = draftFrom(chicken as LogEntry, NY);
    expect(patchFor(chicken as LogEntry, readDraft(d, chicken as LogEntry), NY)).toEqual({});
  });

  test('a new time only sends eaten_at', () => {
    const d = { ...draftFrom(chicken as LogEntry, NY), time: '19:00' };
    const r = readDraft(d, chicken as LogEntry);
    expect(patchFor(chicken as LogEntry, r, NY)).toEqual({
      eaten_at: '2026-10-17T23:00:00.000Z',
    });
  });

  test('grams, a quantity of the same unit, or switching a unit entry to grams', () => {
    const c = chicken as LogEntry;
    const r = rice as LogEntry;
    expect(patchFor(c, readDraft({ ...draftFrom(c, NY), amount: '200' }, c), NY)).toEqual({
      grams: 200,
    });
    expect(patchFor(r, readDraft({ ...draftFrom(r, NY), amount: '1.5' }, r), NY)).toEqual({
      quantity: 1.5,
    });
    expect(
      patchFor(r, readDraft({ ...draftFrom(r, NY), amount: '250', unit: 'g' }, r), NY),
    ).toEqual({ grams: 250 });
  });

  test('bad amounts and future days are explained', () => {
    const c = chicken as LogEntry;
    expect(readDraft({ ...draftFrom(c, NY), amount: '0' }, c).errors).toEqual({
      amount: 'Enter an amount above 0, up to 5,000 g.',
    });
    expect(readDraft({ ...draftFrom(c, NY), amount: '6000' }, c).errors.amount).toBeDefined();
    expect(readDraft({ ...draftFrom(c, NY), date: '2026-10-18' }, c, '2026-10-17').errors).toEqual({
      date: 'Choose today or an earlier day.',
    });
  });
});

describe('previewFor', () => {
  test('scales the snapshot like the server does', () => {
    const c = chicken as LogEntry;
    expect(previewFor(c, 175)).toMatchObject({ kcal: 170.63, protein_g: 36.93, carbs_g: 0 });
    expect(previewFor(c, null)).toBeNull();
  });
});
