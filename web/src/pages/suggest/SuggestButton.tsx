import { useState } from 'react';
import type { LogEntry } from '../../api/logs';
import { secondaryButton } from '../account/Section';
import { SuggestSheet } from './SuggestSheet';

/** "What should I eat?" on Today and Log food; opens the suggestion sheet at `wall`. */
export function SuggestButton({
  timeZone,
  wall,
  onLogged,
  className = '',
}: {
  timeZone: string;
  wall: string;
  onLogged: (entries: LogEntry[], wall: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${secondaryButton} cursor-pointer ${className}`}
      >
        What should I eat?
      </button>
      {open ? (
        <SuggestSheet
          timeZone={timeZone}
          wall={wall}
          onClose={() => setOpen(false)}
          onLogged={(entries, at) => {
            setOpen(false);
            onLogged(entries, at);
          }}
        />
      ) : null}
    </>
  );
}
