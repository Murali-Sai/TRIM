import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { updateProfile } from '../api/account';
import { useMe } from '../api/auth';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '../theme';
import { useLogout } from '../useLogout';
import { usePageTitle } from '../usePageTitle';
import { DeleteSection } from './account/DeleteSection';
import { DevicesSection } from './account/DevicesSection';
import { ImportSection } from './account/ImportSection';
import { PasswordSection } from './account/PasswordSection';
import { ProfileSection } from './account/ProfileSection';
import { secondaryButton, Section } from './account/Section';
import { TrackingSection } from './account/TrackingSection';

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Match device' },
];

function TargetsSection() {
  const link =
    'tap inline-block rounded-lg border border-border bg-surface px-4 py-2.5 font-semibold';
  return (
    <Section
      title="Targets"
      description="Your calorie and macro targets, the TDEE calculator and diet phases."
    >
      <div className="flex flex-wrap gap-3">
        <Link to="/targets" className={link}>
          Edit targets
        </Link>
        <Link to="/targets/calculator" className={link}>
          TDEE calculator
        </Link>
        <Link to="/phases" className={link}>
          Diet phases
        </Link>
      </div>
    </Section>
  );
}

function StaplesSection() {
  return (
    <Section
      title="My staples"
      description="Up to 20 foods and meals you eat often, for suggestions."
    >
      <Link
        to="/staples"
        className="tap inline-block rounded-lg border border-border bg-surface px-4 py-2.5 font-semibold"
      >
        Manage staples
      </Link>
    </Section>
  );
}

function DownloadSection() {
  return (
    <Section
      title="Download my data"
      description="Everything you have logged, as Excel, CSV or JSON, whenever you like."
    >
      <Link
        to="/account/export"
        className="tap inline-block rounded-lg border border-border bg-surface px-4 py-2.5 font-semibold"
      >
        Download my data
      </Link>
    </Section>
  );
}

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
          <TargetsSection />
          <StaplesSection />
          <TrackingSection />
          <AppearanceSection />
          <DevicesSection />
        </div>
        <div className="flex flex-col gap-4 lg:gap-6">
          <PasswordSection />
          <DownloadSection />
          <ImportSection />
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
