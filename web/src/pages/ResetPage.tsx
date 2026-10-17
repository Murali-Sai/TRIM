import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { resetPassword } from '../api/auth';
import { ApiError } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { Field } from '../components/Field';
import { takeTokenFromHash } from '../urlToken';
import { usePageTitle } from '../usePageTitle';

const MIN_PASSWORD = 10;
const LINK_INVALID = 'This link has expired or was already used.';

export function ResetPage() {
  usePageTitle('Choose a new password');
  const queryClient = useQueryClient();
  const [token] = useState(takeTokenFromHash);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  const mutation = useMutation({
    mutationFn: resetPassword,
    // Every session ended on the server, this one included.
    onSuccess: () => queryClient.clear(),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found: typeof errors = {};
    if (password.length < MIN_PASSWORD) found.password = `Use at least ${MIN_PASSWORD} characters.`;
    else if (password !== confirm) found.confirm = 'The passwords do not match.';
    setErrors(found);
    if (Object.keys(found).length > 0 || !token) return;
    mutation.mutate({ token, password });
  }

  const linkDead =
    !token || (mutation.error instanceof ApiError && mutation.error.userMessage === LINK_INVALID);

  if (linkDead) {
    return (
      <AuthLayout>
        <h2 className="text-center text-2xl font-bold">Link expired</h2>
        <p className="mt-3 text-center">
          {token ? LINK_INVALID : 'This link is not complete.'} Ask for a new one.
        </p>
        <Link
          to="/forgot"
          className="tap mt-6 block rounded-lg bg-accent px-4 py-3 text-center font-semibold text-accent-contrast"
        >
          Get a new link
        </Link>
      </AuthLayout>
    );
  }

  if (mutation.isSuccess) {
    return (
      <AuthLayout>
        <h2 className="text-center text-2xl font-bold">Password changed</h2>
        <p className="mt-3 text-center">
          You are signed out on every device. Log in with your new password.
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
      <h2 className="text-2xl font-bold">Choose a new password</h2>
      <p className="mt-2 text-text-secondary">This signs you out on every device.</p>
      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters. A short phrase works well.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <Field
          id="confirm"
          label="Type it again"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
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
          {mutation.isPending ? 'Saving' : 'Save new password'}
        </button>
      </form>
    </AuthLayout>
  );
}
