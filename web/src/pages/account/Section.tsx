import type { ReactNode } from 'react';

export function Section({
  title,
  description,
  children,
  testId,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  testId?: string;
}) {
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section
      aria-labelledby={id}
      className="rounded-xl border border-border bg-surface p-4"
      data-testid={testId}
    >
      <h3 id={id} className="text-lg font-semibold">
        {title}
      </h3>
      {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Notice({ kind, children }: { kind: 'ok' | 'error'; children: ReactNode }) {
  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      className={`mt-3 rounded-lg p-3 text-sm ${
        kind === 'error' ? 'border border-error bg-surface-2' : 'bg-surface-2'
      }`}
    >
      {children}
    </p>
  );
}

export const primaryButton =
  'tap rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-contrast disabled:opacity-60';
export const secondaryButton =
  'tap rounded-lg border border-border bg-surface px-4 py-2.5 font-semibold disabled:opacity-60';
