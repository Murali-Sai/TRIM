import type { InputHTMLAttributes } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
}

/** A labeled text input with an optional hint and an inline error tied to it for screen readers. */
export function Field({ id, label, hint, error, className = '', ...input }: FieldProps) {
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className}>
      <label htmlFor={id} className="block font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        className={`tap mt-1 w-full rounded-lg border bg-surface px-3 py-2.5 text-text ${
          error ? 'border-error' : 'border-border'
        }`}
        {...input}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-text-secondary">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
