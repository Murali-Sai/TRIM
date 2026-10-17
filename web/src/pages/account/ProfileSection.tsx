import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { updateProfile } from '../../api/account';
import { ME_KEY, type Me, type UnitSystem } from '../../api/auth';
import { ApiError } from '../../api/client';
import { Field } from '../../components/Field';
import { Notice, primaryButton, Section } from './Section';

function timezones(current: string): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {
    all = [];
  }
  return all.includes(current) ? all : [current, ...all];
}

export function ProfileSection({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.display_name);
  const [timezone, setTimezone] = useState(me.timezone);
  const [units, setUnits] = useState<UnitSystem>(me.unit_system);
  const [nameError, setNameError] = useState<string | null>(null);
  const zones = useMemo(() => timezones(me.timezone), [me.timezone]);

  const save = useMutation({
    mutationFn: updateProfile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_KEY }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Enter a name.');
      return;
    }
    setNameError(null);
    save.mutate({ display_name: name.trim(), timezone, unit_system: units });
  }

  return (
    <Section title="Profile">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field
          id="profile-name"
          label="Name"
          value={name}
          maxLength={50}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
        />
        <div>
          <label htmlFor="profile-timezone" className="block font-semibold">
            Timezone
          </label>
          <select
            id="profile-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5"
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <p className="mt-1 text-sm text-text-secondary">Your days start at midnight here.</p>
        </div>
        <fieldset>
          <legend className="font-semibold">Units</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(['metric', 'imperial'] as const).map((u) => (
              <label
                key={u}
                className={`tap flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2.5 ${
                  units === u ? 'border-accent font-semibold' : 'border-border'
                }`}
              >
                <input
                  type="radio"
                  name="profile-units"
                  value={u}
                  checked={units === u}
                  onChange={() => setUnits(u)}
                  className="sr-only"
                />
                {u === 'metric' ? 'Metric (kg, cm)' : 'Imperial (lb, in)'}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <button type="submit" disabled={save.isPending} className={primaryButton}>
            {save.isPending ? 'Saving' : 'Save profile'}
          </button>
        </div>
      </form>
      {save.isSuccess ? <Notice kind="ok">Profile saved.</Notice> : null}
      {save.error ? (
        <Notice kind="error">
          {save.error instanceof ApiError && save.error.userMessage
            ? save.error.userMessage
            : 'Could not save. Check the fields and try again.'}
        </Notice>
      ) : null}
    </Section>
  );
}
