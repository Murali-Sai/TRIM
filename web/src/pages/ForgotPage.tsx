import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { forgotPassword } from '../api/auth';
import { ApiError } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { Field } from '../components/Field';
import { Turnstile } from '../components/Turnstile';
import { usePageTitle } from '../usePageTitle';

export function ForgotPage() {
  usePageTitle('Reset password');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: forgotPassword,
    onSettled: () => setResetKey((k) => k + 1),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setProblem('Enter a valid email.');
      return;
    }
    if (!token) {
      setProblem('Complete the check above to continue.');
      return;
    }
    setProblem(null);
    mutation.mutate({ email: email.trim(), turnstile_token: token });
  }

  if (mutation.isSuccess) {
    return (
      <AuthLayout>
        <h2 className="text-center text-2xl font-bold">Check your email</h2>
        <p className="mt-3 text-center">
          If <span className="font-semibold break-all">{email.trim()}</span> has a TRIM account, a
          reset link is on its way. It works for 1 hour.
        </p>
        <Link
          to="/login"
          className="tap mt-6 block rounded-lg bg-accent px-4 py-3 text-center font-semibold text-accent-contrast"
        >
          Back to log in
        </Link>
      </AuthLayout>
    );
  }

  const error =
    problem ??
    (mutation.error instanceof ApiError
      ? (mutation.error.userMessage ?? 'Something went wrong. Try again.')
      : mutation.error
        ? 'Something went wrong. Try again.'
        : null);

  return (
    <AuthLayout>
      <h2 className="text-2xl font-bold">Reset your password</h2>
      <p className="mt-2 text-text-secondary">
        Enter the email you signed up with and we will send you a link.
      </p>
      <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Turnstile onToken={setToken} resetKey={resetKey} />
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
          {mutation.isPending ? 'Sending' : 'Send reset link'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="font-semibold text-accent underline">
          Back to log in
        </Link>
      </p>
    </AuthLayout>
  );
}
