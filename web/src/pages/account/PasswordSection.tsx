import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { changePassword, SESSIONS_KEY } from '../../api/account';
import { ApiError } from '../../api/client';
import { Field } from '../../components/Field';
import { Notice, primaryButton, Section } from './Section';

const MIN_PASSWORD = 10;

export function PasswordSection() {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});

  const save = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found: typeof errors = {};
    if (!current) found.current = 'Enter your current password.';
    if (next.length < MIN_PASSWORD) found.next = `Use at least ${MIN_PASSWORD} characters.`;
    else if (next !== confirm) found.confirm = 'The passwords do not match.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate({ current_password: current, new_password: next, keep_signed_in: true });
  }

  return (
    <Section title="Password" description="Changing it signs you out on your other devices.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field
          id="current-password"
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={errors.current}
        />
        <Field
          id="new-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={errors.next}
        />
        <Field
          id="confirm-password"
          label="Type it again"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        <div>
          <button type="submit" disabled={save.isPending} className={primaryButton}>
            {save.isPending ? 'Saving' : 'Change password'}
          </button>
        </div>
      </form>
      {save.isSuccess ? (
        <Notice kind="ok">Password changed. Your other devices are signed out.</Notice>
      ) : null}
      {save.error ? (
        <Notice kind="error">
          {save.error instanceof ApiError && save.error.userMessage
            ? save.error.userMessage
            : 'Could not change the password. Try again.'}
        </Notice>
      ) : null}
    </Section>
  );
}
