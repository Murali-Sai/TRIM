import { deleteJson, getJson, patchJson, postJson, putJson } from './client';

/** "cm" and "in" both store cm, "kg" and "lb" both store kg: the unit only sets the display. */
export type MeasureUnit = 'cm' | 'in' | '%' | 'kg' | 'lb' | 'text';

export interface MeasurementType {
  id: string;
  name: string;
  unit: MeasureUnit;
  precision: number;
  side: 'left' | 'right' | null;
  pair_id: string | null;
  is_preset: boolean;
  is_active: boolean;
  sort_order: number;
  archived_at: string | null;
  entries: number;
  latest: { value: number | null; value_text: string | null; measured_at: string } | null;
}

export interface MeasurementTypePatch {
  name?: string;
  unit?: MeasureUnit;
  precision?: number;
  is_active?: boolean;
  archived?: boolean;
}

export interface Reading {
  id: string;
  type_id: string;
  /** In the stored unit: cm, kg or %. */
  value: number | null;
  value_text: string | null;
  measured_at: string;
  note: string | null;
}

export type ReadingInput = { type_id: string; note?: string | null } & (
  { value: number } | { value_text: string }
);

export const MEASUREMENT_TYPES_KEY = ['measurement-types'] as const;
export const MEASUREMENTS_KEY = ['measurements'] as const;

export function listTypes(archived?: boolean) {
  return getJson<MeasurementType[]>(
    `/measurement-types${archived === undefined ? '' : `?archived=${archived}`}`,
  );
}

export function createType(body: {
  name: string;
  unit: MeasureUnit;
  precision?: number;
  paired?: boolean;
}) {
  return postJson<MeasurementType[]>('/measurement-types', body);
}

/** A pair changes together. */
export function editType(id: string, body: MeasurementTypePatch) {
  return patchJson<MeasurementType[]>(`/measurement-types/${id}`, body);
}

export function reorderTypes(ids: string[]) {
  return putJson<MeasurementType[]>('/measurement-types/order', { ids });
}

export function listReadings(params: { type_id?: string; date_from?: string; date_to?: string }) {
  const q = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => !!e[1]),
  );
  return getJson<Reading[]>(`/measurements${q.size ? `?${q}` : ''}`);
}

/** Several metrics measured at one time. */
export function addReadings(items: ReadingInput[], measuredAt?: string) {
  return postJson<Reading[]>('/measurements', {
    items,
    ...(measuredAt ? { measured_at: measuredAt } : {}),
  });
}

export function editReading(
  id: string,
  body: { value?: number; value_text?: string; measured_at?: string; note?: string | null },
) {
  return patchJson<Reading>(`/measurements/${id}`, body);
}

export function deleteReading(id: string) {
  return deleteJson<null>(`/measurements/${id}`);
}

/** A pair shown as one metric: its name and both sides' ids. */
export interface Metric {
  key: string;
  name: string;
  types: MeasurementType[];
}

export function asMetrics(types: readonly MeasurementType[]): Metric[] {
  const out: Metric[] = [];
  const seen = new Map<string, Metric>();
  for (const t of types) {
    const key = t.pair_id ?? t.id;
    const m = seen.get(key);
    if (m) m.types.push(t);
    else {
      const metric = { key, name: t.name, types: [t] };
      seen.set(key, metric);
      out.push(metric);
    }
  }
  return out;
}
