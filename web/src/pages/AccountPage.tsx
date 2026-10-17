import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { updateProfile } from '../api/account';
import { useMe } from '../api/auth';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '../theme';
import { useLogout } from '../useLogout';
import { usePageTitle } from '../usePageTitle';
import { DeleteSection } from './account/DeleteSection';
import { DevicesSection } from './account/DevicesSection';
import { PasswordSection } from './account/PasswordSection';
import { ProfileSection } from './account/ProfileSection';
import { secondaryButton, Section } from './account/Section';

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Match device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function AppearanceSection() {
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  const save = useMutation({ mutationFn: updateProfile });
  return (
    <Section title="Appearance">
      <label htmlFor="theme" className="block font-semibold">
        Theme
      </label>
      <select
        id="theme"
        className="tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 sm:w-64"
        value={theme}
        onChange={(e) => {
          const choice = e.target.value as ThemeChoice;
          setTheme(choice);
          setThemeChoice(choice);
          save.mutate({ theme: choice });
        }}
      >
        {THEME_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Section>
  );
}

export function AccountPage() {
  usePageTitle('Account');
  const me = useMe();
  const logout = useLogout();
  if (!me.data) return null;

  return (
    <section>
      <h2 className="text-2xl font-bold">Account</h2>
      <p className="mt-1 break-all text-text-secondary">{me.data.email}</p>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4 lg:gap-6">
          <ProfileSection me={me.data} />
          <AppearanceSection />
          <DevicesSection />
        </div>
        <div className="flex flex-col gap-4 lg:gap-6">
          <PasswordSection />
          <DeleteSection />
          <div>
            <button
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className={secondaryButton}
            >
              Log out
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
