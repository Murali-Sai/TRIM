import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { listDays, LOGS_KEY } from '../../api/logs';
import { listTargets, TARGETS_KEY } from '../../api/setup';
import { readStored, writeStored } from '../../lib/chart/storage';
import { addDays, daySeries, rangeDates, type SeriesDay } from '../../lib/nutritionSeries';
import { RANGES, type RangeKey } from '../../lib/weightChart';
import { isoToZonedWall } from '../../lib/zoned';

/** How far back All can reach (the API's limit). */
const ALL_DAYS = 3660;

/** The remembered range for a chart (SPEC: calories open at 1W; the last range is kept). */
export function useRange(key: string, fallback: RangeKey = '1W') {
  const [range, setRange] = useState<RangeKey>(() => {
    const v = readStored(key);
    return RANGES.includes(v as RangeKey) ? (v as RangeKey) : fallback;
  });
  return [
    range,
    (r: RangeKey) => {
      setRange(r);
      writeStored(key, r);
    },
  ] as const;
}

/** Day-by-day calories and macros with the target in effect each day, for `range`. */
export function useDaySeries(range: RangeKey, timeZone: string) {
  const today = isoToZonedWall(new Date().toISOString(), timeZone).slice(0, 10);
  const fetchFrom =
    range === 'All' ? addDays(today, -(ALL_DAYS - 1)) : rangeDates(range, today, null)[0];
  const days = useQuery({
    queryKey: [...LOGS_KEY, 'days', fetchFrom, today],
    queryFn: () => listDays(fetchFrom, today),
  });
  const targets = useQuery({ queryKey: TARGETS_KEY, queryFn: listTargets });
  const series = useMemo<SeriesDay[] | null>(() => {
    if (!days.data || !targets.data) return null;
    const [from, to] = rangeDates(range, today, days.data[0]?.date ?? null);
    return daySeries(days.data, targets.data, from, to);
  }, [days.data, targets.data, range, today]);
  return {
    series,
    today,
    isError: days.isError || targets.isError,
  };
}
