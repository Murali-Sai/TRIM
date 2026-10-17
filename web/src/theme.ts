export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'trim.theme';

export function getThemeChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Storage can be blocked; fall back to the OS setting.
  }
  return 'system';
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not persisted, but still applied for this page view.
  }
  applyTheme(choice);
}
