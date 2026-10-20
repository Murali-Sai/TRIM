import { useId, useState } from 'react';
import { blockLabel, shiftWall, timeChipLabel } from '../../lib/logTime';

interface Props {
  /** The chosen time, "YYYY-MM-DDTHH:mm" in the user's timezone. */
  wall: string;
  /** Now, rounded down to 5 minutes. */
  now: string;
  /** The time of day of the user's last add, if any. */
  lastUsed: string | null;
  onChange: (wall: string) => void;
}

const chip = 'tap rounded-full border px-3 py-1.5 text-sm font-semibold';

/**
 * When the food was eaten. One tap opens the picker: a native time input (a wheel on iPhone),
 * a date for past days, and the Now, -30 min, -1 h and last-used chips.
 */
export function TimeChip({ wall, now, lastUsed, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const timeId = `${panel}-time`;
  const dateId = `${panel}-date`;
  const today = now.slice(0, 10);
  const day = wall.slice(0, 10);
  // Last used keeps the chosen day and takes the time of day.
  const lastOnDay = lastUsed ? `${day}T${lastUsed.slice(11, 16)}` : null;
  const quick = [
    { label: 'Now', wall: now },
    { label: '-30 min', wall: shiftWall(now, -30) },
    { label: '-1 h', wall: shiftWall(now, -60) },
    ...(lastOnDay && lastOnDay <= now
      ? [{ label: `${blockLabel(lastOnDay)} (last used)`, wall: lastOnDay }]
      : []),
  ];

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((o) => !o)}
        className="tap inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 font-semibold"
        data-testid="time-chip"
      >
        <span className="sr-only">Time eaten: </span>
        {timeChipLabel(wall, today)}
      </button>
      {open ? (
        <div id={panel} className="mt-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick times">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                aria-pressed={q.wall === wall}
                onClick={() => onChange(q.wall)}
                className={`${chip} ${q.wall === wall ? 'border-accent bg-surface-2' : 'border-border'}`}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={timeId} className="block font-semibold">
                Time
              </label>
              <input
                id={timeId}
                type="time"
                value={wall.slice(11, 16)}
                onChange={(e) => e.target.value && onChange(`${day}T${e.target.value}`)}
                className="tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5"
              />
            </div>
            <div>
              <label htmlFor={dateId} className="block font-semibold">
                Date
              </label>
              <input
                id={dateId}
                type="date"
                value={day}
                max={today}
                onChange={(e) =>
                  e.target.value &&
                  e.target.value <= today &&
                  onChange(`${e.target.value}T${wall.slice(11, 16)}`)
                }
                className="tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="tap mt-4 text-sm font-semibold text-accent underline"
          >
            Done
          </button>
        </div>
      ) : null}
    </div>
  );
}
