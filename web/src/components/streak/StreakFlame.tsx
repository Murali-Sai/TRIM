import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { readStored, writeStored } from '../../lib/chart/storage';
import { FlameIcon } from '../icons';
import { MilestoneCard } from './MilestoneCard';
import { StreakSheet } from './StreakSheet';
import { MILESTONES, useStreaks } from './useStreaks';

const POP_MS = 900;

/**
 * The flame and streak number beside the title block. Grey until today is logged, colored
 * once it is; the first entry of the day makes it pop and the number tick up (skipped under
 * prefers-reduced-motion). Hidden entirely when streaks are off.
 */
export function StreakFlame({ placement }: { placement: 'header' | 'sidebar' }) {
  const { on, streaks, goals } = useStreaks();
  const [open, setOpen] = useState(false);
  const [pop, setPop] = useState(false);
  const [milestone, setMilestone] = useState<number | null>(null);
  const wasLogged = useRef<boolean | null>(null);

  const logged = streaks?.today_logged ?? null;
  useEffect(() => {
    if (logged === null) return;
    if (wasLogged.current === false && logged) {
      setPop(true);
      const t = setTimeout(() => setPop(false), POP_MS);
      wasLogged.current = logged;
      return () => clearTimeout(t);
    }
    wasLogged.current = logged;
    return undefined;
  }, [logged]);

  const current = streaks?.current_days ?? 0;
  useEffect(() => {
    // Both flames are mounted (CSS shows one per width); only the header copy owns the card,
    // which goes to <body> so it shows at every width.
    if (placement !== 'header') return;
    if (!logged || !(MILESTONES as readonly number[]).includes(current)) return;
    const key = `trim.milestone.${current}`;
    if (readStored(key)) return;
    writeStored(key, streaks?.today ?? 'yes');
    setMilestone(current);
  }, [logged, current, placement, streaks?.today]);
  const closeMilestone = useCallback(() => setMilestone(null), []);

  if (!on || !streaks) return null;
  const label = `${current}-day streak${streaks.today_logged ? ', today logged' : ', today not logged yet'}. Open streak details.`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        className="tap flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 py-1 font-semibold transition-colors duration-200 hover:bg-surface-2"
        data-testid={`streak-flame-${placement}`}
        data-logged={streaks.today_logged ? 'true' : 'false'}
        data-pop={pop ? 'true' : undefined}
      >
        <span
          aria-hidden="true"
          className={`${streaks.today_logged ? 'text-streak' : 'text-text-secondary'} ${
            pop ? 'motion-safe:animate-[flame-pop_600ms_ease-out]' : ''
          } inline-block`}
          data-testid="flame-icon"
        >
          <FlameIcon width={22} height={22} />
        </span>
        <span
          key={current}
          aria-hidden="true"
          className={`num inline-block ${pop ? 'motion-safe:animate-[tick-up_400ms_ease-out]' : ''}`}
        >
          {current}
        </span>
      </button>
      {/* Portals: the header is its own stacking context, under the tab bar. */}
      {open
        ? createPortal(
            <StreakSheet streaks={streaks} goals={goals} onClose={() => setOpen(false)} />,
            document.body,
          )
        : null}
      {milestone !== null
        ? createPortal(<MilestoneCard days={milestone} onClose={closeMilestone} />, document.body)
        : null}
    </>
  );
}
