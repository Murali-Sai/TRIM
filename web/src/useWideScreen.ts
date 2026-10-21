import { useSyncExternalStore } from 'react';

const QUERY = '(min-width: 1024px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function wide(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

/** True at the desktop layout (Tailwind's lg, 1024 px and up). */
export function useWideScreen(): boolean {
  return useSyncExternalStore(subscribe, wide, () => false);
}
