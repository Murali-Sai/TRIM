import { useEffect } from 'react';

export interface ToastMessage {
  /** Changes for each new toast, so the timer restarts. */
  id: number;
  text: string;
  action?: { label: string; onClick: () => void };
}

const SHOWN_MS = 5000;

/** A short confirmation above the tab bar (bottom right on desktop) that goes away by itself. */
export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, SHOWN_MS);
    return () => clearTimeout(t);
  }, [toast, onDone]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+5.5rem)] z-40 flex justify-center px-4 lg:inset-x-auto lg:bottom-6 lg:right-6"
    >
      {toast ? (
        <div
          key={toast.id}
          className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-text px-4 py-2 text-surface shadow-lg motion-safe:animate-[fade-in_200ms_ease-out]"
          data-testid="toast"
        >
          <p className="text-sm">{toast.text}</p>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                onDone();
              }}
              className="tap -my-1 cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold underline"
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
