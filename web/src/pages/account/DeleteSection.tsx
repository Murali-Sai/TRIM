import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { deleteAccount } from '../../api/account';
import { ApiError } from '../../api/client';
import { Field } from '../../components/Field';
import { Notice, secondaryButton, Section } from './Section';

export function DeleteSection() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');

  const remove = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      queryClient.clear();
      navigate('/welcome', { replace: true });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (typed !== 'DELETE' || !password) return;
    remove.mutate({ password, confirm: 'DELETE' });
  }

  return (
    <Section
      title="Delete account"
      description="Removes your account and everything you have logged. This cannot be undone."
      testId="delete-account"
    >
      {open ? (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field
            id="delete-password"
            label="Your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Field
            id="delete-confirm"
            label="Type DELETE to confirm"
            autoComplete="off"
            autoCapitalize="characters"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={typed !== 'DELETE' || !password || remove.isPending}
              className="tap rounded-lg bg-error px-4 py-2.5 font-semibold text-bg disabled:opacity-50"
            >
              {remove.isPending ? 'Deleting' : 'Delete my account'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPassword('');
                setTyped('');
              }}
              className={secondaryButton}
            >
              Cancel
            </button>
          </div>
          {remove.error ? (
            <Notice kind="error">
              {remove.error instanceof ApiError && remove.error.userMessage
                ? remove.error.userMessage
                : 'Could not delete the account. Try again.'}
            </Notice>
          ) : null}
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={secondaryButton}>
          Delete account
        </button>
      )}
    </Section>
  );
}
