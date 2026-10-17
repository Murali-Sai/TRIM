import { useState } from 'react';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '../theme';

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Match device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function AccountPage() {
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);

  return (
    <section>
      <h2 className="text-2xl font-bold">Account</h2>
      <div className="mt-6 rounded-xl border border-border bg-surface p-4">
        <label htmlFor="theme" className="block font-semibold">
          Appearance
        </label>
        <select
          id="theme"
          className="tap mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 sm:w-64"
          value={theme}
          onChange={(e) => {
            const choice = e.target.value as ThemeChoice;
            setTheme(choice);
            setThemeChoice(choice);
          }}
        >
          {THEME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
