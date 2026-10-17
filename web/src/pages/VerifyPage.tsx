import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { verifyEmail } from '../api/auth';
import { ApiError } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { takeTokenFromHash } from '../urlToken';
import { usePageTitle } from '../usePageTitle';

export function VerifyPage() {
  usePageTitle('Confirm email');
  const [token] = useState(takeTokenFromHash);
  const { mutate, status, error } = useMutation({ mutationFn: verifyEmail });

  // The token is single use, so send it exactly once (StrictMode runs effects twice in dev).
  const sent = useRef(false);
  useEffect(() => {
    if (token && !sent.current) {
      sent.current = true;
      mutate(token);
    }
  }, [token, mutate]);

  let title: string;
  let body: string;
  if (!token) {
    title = 'Link not complete';
    body = 'Open the link from your email again, or log in to get a new one.';
  } else if (status === 'success') {
    title = 'Email confirmed';
    body = 'Thanks. Your account is all set.';
  } else if (status === 'error') {
    title = 'Link expired';
    body =
      error instanceof ApiError && error.userMessage
        ? `${error.userMessage} Log in to get a new link.`
        : 'Something went wrong. Try the link again.';
  } else {
    title = 'Confirming your email';
    body = 'One moment.';
  }

  return (
    <AuthLayout>
      <div role="status" aria-live="polite">
        <h2 className="text-center text-2xl font-bold">{title}</h2>
        <p className="mt-3 text-center">{body}</p>
      </div>
      {status !== 'pending' && status !== 'idle' ? (
        <Link
          to={status === 'success' ? '/' : '/login'}
          className="tap mt-6 block rounded-lg bg-accent px-4 py-3 text-center font-semibold text-accent-contrast"
        >
          {status === 'success' ? 'Continue' : 'Log in'}
        </Link>
      ) : null}
      {!token ? (
        <Link
          to="/login"
          className="tap mt-6 block rounded-lg bg-accent px-4 py-3 text-center font-semibold text-accent-contrast"
        >
          Log in
        </Link>
      ) : null}
    </AuthLayout>
  );
}
