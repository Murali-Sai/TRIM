import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { login, ME_KEY } from '../api/auth';
import { ApiError } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { Field } from '../components/Field';
import { usePageTitle } from '../usePageTitle';

export function LoginPage() {
  usePageTitle('Log in');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(false);
  const [missing, setMissing] = useState(false);

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
      navigate('/', { replace: true });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setMissing(true);
      return;
    }
    setMissing(false);
    mutation.mutate({ email: email.trim(), password, keep_signed_in: keep });
  }

  const error = missing
    ? 'Enter your email and password.'
    : mutation.error instanceof ApiError
      ? (mutation.error.userMessage ?? 'Something went wrong. Try again.')
      : mutation.error
        ? 'Something went wrong. Try again.'
        : null;

  return (
    <AuthLayout>
      <h2 className="text-2xl font-bold">Log in</h2>
      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div>
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Link
            to="/forgot"
            className="tap mt-1 inline-flex items-center text-sm text-accent underline"
          >
            Forgot password?
          </Link>
        </div>
        <label className="tap flex items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--color-accent)]"
            checked={keep}
            onChange={(e) => setKeep(e.target.checked)}
          />
          <span>
            Keep me signed in
            <span className="block text-sm text-text-secondary">
              For 30 days on this device. Leave off on shared computers.
            </span>
          </span>
        </label>
        {error ? (
          <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="tap rounded-lg bg-accent px-4 py-3 font-semibold text-accent-contrast disabled:opacity-60"
        >
          {mutation.isPending ? 'Logging in' : 'Log in'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm">
        New to TRIM?{' '}
        <Link to="/signup" className="font-semibold text-accent underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
