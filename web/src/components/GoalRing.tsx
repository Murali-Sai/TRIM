import type { Goal } from '../api/goals';

const R = 18;
const C = 2 * Math.PI * R;

/** A progress ring for one weekly goal, with the count in the middle and the goal in words. */
export function GoalRing({ goal }: { goal: Goal }) {
  const share = goal.needed > 0 ? Math.min(1, goal.done / goal.needed) : 0;
  return (
    <figure
      className="flex min-w-0 flex-col items-center gap-1 text-center"
      data-testid={`goal-${goal.kind}`}
    >
      <svg
        viewBox="0 0 44 44"
        width="56"
        height="56"
        role="img"
        aria-label={`${goal.text}: ${goal.done} of ${goal.needed}${goal.complete ? ', done' : ''}`}
      >
        <circle cx="22" cy="22" r={R} fill="none" stroke="var(--color-surface-2)" strokeWidth="5" />
        <circle
          cx="22"
          cy="22"
          r={R}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${share * C} ${C}`}
          transform="rotate(-90 22 22)"
          className="transition-[stroke-dasharray] duration-300 motion-reduce:transition-none"
        />
        <text
          x="22"
          y="26"
          textAnchor="middle"
          className="num"
          fontSize="11"
          fontWeight="600"
          fill="var(--color-text)"
        >
          {goal.complete ? '✓' : `${goal.done}/${goal.needed}`}
        </text>
      </svg>
      <figcaption className="text-xs leading-snug text-text-secondary">{goal.text}</figcaption>
    </figure>
  );
}
