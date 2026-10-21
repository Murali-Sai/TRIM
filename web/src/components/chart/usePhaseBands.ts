import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useMe } from '../../api/auth';
import { listPhases, PHASES_KEY } from '../../api/phases';
import { usePhasesShown } from '../../lib/chart/phaseToggle';
import { phaseBands, type PhaseBand } from '../../lib/phases';
import { isoToZonedWall } from '../../lib/zoned';

const NONE: PhaseBand[] = [];

/**
 * The user's phases as chart bands, empty while the Phases toggle is off. `axis` says how the
 * chart places days (lib/phases.ts, DayAxis): real instants in the user's timezone, or dates
 * at noon UTC.
 */
export function usePhaseBands(axis: 'zoned' | 'utc-days') {
  const shown = usePhasesShown();
  const timeZone = useMe().data?.timezone ?? 'UTC';
  const q = useQuery({ queryKey: [...PHASES_KEY, 'bands'], queryFn: () => listPhases(false) });
  const today = isoToZonedWall(new Date().toISOString(), timeZone).slice(0, 10);
  const all = useMemo(
    () =>
      q.data
        ? phaseBands(
            q.data,
            axis === 'zoned' ? { kind: 'zoned', timeZone } : { kind: 'utc-days' },
            today,
          )
        : NONE,
    [q.data, axis, timeZone, today],
  );
  return { bands: shown ? all : NONE, hasPhases: all.length > 0 };
}
