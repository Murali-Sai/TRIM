import { useState, type FormEvent } from 'react';
import { Sheet } from '../../components/Sheet';
import { relativeDay } from '../../lib/logTime';
import { primaryButton } from '../account/Section';

export type MoveCopyMode = 'move' | 'copy';

interface Props {
  mode: MoveCopyMode;
  /** How many entries, for the heading. */
  count: number;
  /** Starting time, "YYYY-MM-DDTHH:mm" in the user's timezone. */
  wall: string;
  today: string;
  busy: boolean;
  onConfirm: (wall: string) => void;
  onClose: () => void;
}

const input = 'tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-text';

/** Pick the time and day to move entries to, or to copy them to. */
export function MoveCopySheet({ mode, count, wall, today, busy, onConfirm, onClose }: Props) {
  const [date, setDate] = useState(wall.slice(0, 10));
  const [time, setTime] = useState(wall.slice(11, 16));
  const items = `${count} ${count === 1 ? 'item' : 'items'}`;
  const verb = mode === 'move' ? 'Move' : 'Copy';
  const day = relativeDay(date, today);
  const dayName = day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (date > today) return;
    onConfirm(`${date}T${time}`);
  }

  return (
    <Sheet title={`${verb} ${items}`} onClose={onClose} testId="move-copy-sheet">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="mc-time" className="block font-semibold">
              Time
            </label>
            <input
              id="mc-time"
              type="time"
              value={time}
              onChange={(e) => e.target.value && setTime(e.target.value)}
              className={input}
            />
          </div>
          <div>
            <label htmlFor="mc-date" className="block font-semibold">
              Date
            </label>
            <input
              id="mc-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && e.target.value <= today && setDate(e.target.value)}
              className={input}
            />
          </div>
        </div>
        {mode === 'copy' && date !== today ? (
          <button
            type="button"
            onClick={() => setDate(today)}
            className="tap w-fit cursor-pointer text-sm font-semibold text-accent underline"
          >
            Copy to today
          </button>
        ) : null}
        <button type="submit" disabled={busy} className={`${primaryButton} cursor-pointer`}>
          {busy ? 'Saving' : `${verb} to ${dayName}`}
        </button>
      </form>
    </Sheet>
  );
}
