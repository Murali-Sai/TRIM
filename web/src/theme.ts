export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'trim.theme';

export function getThemeChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Storage can be blocked; fall back to the default.
  }
  // Dark first (SPEC page 1, UX principles).
  return 'dark';
}

export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.setAttribute('data-theme', choice);
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not persisted, but still applied for this page view.
  }
  applyTheme(choice);
}
