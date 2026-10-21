import { useEffect, useRef } from 'react';

/** Original badge art: a round medal with the number of days. */
export function Medal({ days, earned = true }: { days: number | string; earned?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <circle
        cx="32"
        cy="32"
        r="27"
        fill={earned ? 'var(--color-streak)' : 'none'}
        stroke={earned ? 'var(--color-streak)' : 'var(--color-border)'}
        strokeWidth="3"
        strokeDasharray={earned ? undefined : '5 4'}
      />
      <circle
        cx="32"
        cy="32"
        r="20"
        fill="none"
        stroke={earned ? 'var(--color-surface)' : 'var(--color-border)'}
        strokeWidth="1.5"
        opacity={earned ? 0.6 : 1}
      />
      <text
        x="32"
        y="37"
        textAnchor="middle"
        fontSize={String(days).length > 2 ? 13 : 16}
        fontWeight="700"
        fill={earned ? 'var(--color-surface)' : 'var(--color-text-secondary)'}
        className="num"
      >
        {days}
      </text>
    </svg>
  );
}

/** A full-screen card for 7, 30, 100 and 365 days. Sharing is off in v1. */
export function MilestoneCard({ days, onClose }: { days: number; onClose: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="milestone-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/95 p-6 motion-safe:animate-[fade-in_300ms_ease-out]"
      data-testid="milestone-card"
    >
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="motion-safe:animate-[flame-pop_700ms_ease-out]">
          <Medal days={days} />
        </div>
        <h2 id="milestone-title" className="text-2xl font-bold">
          {days}-day streak
        </h2>
        <p className="text-text-secondary">
          You have logged {days} days in a row. The {days}-day badge is yours.
        </p>
        <button
          ref={button}
          type="button"
          onClick={onClose}
          className="tap cursor-pointer rounded-lg bg-accent px-6 py-2.5 font-semibold text-accent-contrast"
        >
          Close
        </button>
      </div>
    </div>
  );
}
