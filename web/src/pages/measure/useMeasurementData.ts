import { useQuery } from '@tanstack/react-query';
import {
  asMetrics,
  listReadings,
  listTypes,
  MEASUREMENT_TYPES_KEY,
  MEASUREMENTS_KEY,
  type Metric,
  type Reading as Entry,
} from '../../api/measurements';
import { readingsOf } from '../../lib/measureSeries';
import type { Reading } from '../../lib/trend';
import { isoToZonedWall } from '../../lib/zoned';

export { sideName } from './rows';

export interface MeasurementData {
  isPending: boolean;
  isError: boolean;
  /** Switched-on metrics, a pair as one, in the user's order. */
  metrics: Metric[];
  /** Number readings per metric side (type id), oldest first, with the local day. */
  readings: Map<string, Reading[]>;
  entries: Map<string, Entry[]>;
}

/** The switched-on metrics and every reading, for the charts and tables. */
export function useMeasurementData(timeZone: string): MeasurementData {
  const types = useQuery({
    queryKey: [...MEASUREMENT_TYPES_KEY, 'live'],
    queryFn: () => listTypes(false),
  });
  const all = useQuery({ queryKey: [...MEASUREMENTS_KEY, 'all'], queryFn: () => listReadings({}) });
  const on = (types.data ?? []).filter((t) => t.is_active);
  const entries = new Map<string, Entry[]>();
  for (const e of all.data ?? []) {
    const list = entries.get(e.type_id) ?? [];
    list.push(e);
    entries.set(e.type_id, list);
  }
  const dayOf = (iso: string) => isoToZonedWall(iso, timeZone).slice(0, 10);
  const readings = new Map(on.map((t) => [t.id, readingsOf(entries.get(t.id) ?? [], dayOf)]));
  return {
    isPending: types.isPending || all.isPending,
    isError: types.isError || all.isError,
    metrics: asMetrics(on),
    readings,
    entries,
  };
}
