import { useEffect, useState } from 'react';

/** Bumps when the theme changes, so a canvas chart redraws with the new colors. */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', bump);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => {
      media.removeEventListener('change', bump);
      observer.disconnect();
    };
  }, []);
  return version;
}
