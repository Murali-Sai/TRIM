import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { signup, type UnitSystem } from '../api/auth';
import { ApiError } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { Field } from '../components/Field';
import { Turnstile } from '../components/Turnstile';
import { defaultUnitSystem, detectTimezone } from '../locale';
import { usePageTitle } from '../usePageTitle';

const MIN_PASSWORD = 10;

interface Errors {
  displayName?: string;
  email?: string;
  password?: string;
}

function validate(displayName: string, email: string, password: string): Errors {
  const errors: Errors = {};
  if (!displayName.trim()) errors.displayName = 'Enter a name.';
  else if (displayName.trim().length > 50) errors.displayName = 'Use 50 characters or fewer.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Enter a valid email.';
  if (password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters.`;
  return errors;
}

export function SignupPage() {
  usePageTitle('Sign up');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [units, setUnits] = useState<UnitSystem>(() => defaultUnitSystem(navigator.language));
  const [timezone] = useState(detectTimezone);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: signup,
    onSettled: () => setResetKey((k) => k + 1),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const found = validate(displayName, email, password);
    setErrors(found);
    if (Object.keys(found).length > 0 || !token) return;
    mutation.mutate({
      email: email.trim(),
      password,
      display_name: displayName.trim(),
      timezone,
      unit_system: units,
      turnstile_token: token,
    });
  }

  if (mutation.isSuccess) {
    return (
      <AuthLayout>
        <h2 className="text-center text-2xl font-bold">Check your email</h2>
        <p className="mt-3 text-center">
          If <span className="font-semibold">{email.trim()}</span> can be used for TRIM, a
          confirmation link is on its way. It works for 1 hour.
        </p>
        <p className="mt-3 text-center text-text-secondary">
          You can start logging now and confirm within 7 days.
        </p>
        <Link
          to="/login"
          className="tap mt-6 block rounded-lg bg-accent px-4 py-3 text-center font-semibold text-accent-contrast"
        >
          Log in
        </Link>
      </AuthLayout>
    );
  }

  const serverError =
    mutation.error instanceof ApiError
      ? (mutation.error.userMessage ?? 'Check the fields above and try again.')
      : mutation.error
        ? 'Something went wrong. Try again.'
        : null;

  return (
    <AuthLayout>
      <h2 className="text-2xl font-bold">Create your account</h2>
      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field
          id="display-name"
          label="Name"
          autoComplete="nickname"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={errors.displayName}
          maxLength={50}
        />
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters. A short phrase works well.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
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
                  name="units"
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
        <p className="text-sm text-text-secondary">
          Timezone: <span data-testid="timezone">{timezone}</span>. Your days start at midnight
          here.
        </p>
        <Turnstile onToken={setToken} resetKey={resetKey} />
        {submitted && !token ? (
          <p className="text-sm font-medium" role="status">
            Complete the check above to continue.
          </p>
        ) : null}
        {serverError ? (
          <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm" role="alert">
            {serverError}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="tap rounded-lg bg-accent px-4 py-3 font-semibold text-accent-contrast disabled:opacity-60"
        >
          {mutation.isPending ? 'Creating account' : 'Sign up'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-accent underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
