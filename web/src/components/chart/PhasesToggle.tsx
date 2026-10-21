import { setPhasesShown, usePhasesShown } from '../../lib/chart/phaseToggle';
import { usePhaseBands } from './usePhaseBands';

/** Shows or hides the phase tints on every time chart. Hidden when there are no phases. */
export function PhasesToggle() {
  const shown = usePhasesShown();
  const { hasPhases } = usePhaseBands('utc-days');
  if (!hasPhases) return null;
  return (
    <button
      type="button"
      aria-pressed={shown}
      onClick={() => setPhasesShown(!shown)}
      className={`tap cursor-pointer rounded-lg border px-3 py-2 text-sm font-semibold transition-colors duration-200 ${
        shown
          ? 'border-text-secondary bg-surface-2 text-text'
          : 'border-border bg-surface text-text-secondary hover:bg-surface-2'
      }`}
    >
      Phases
    </button>
  );
}
