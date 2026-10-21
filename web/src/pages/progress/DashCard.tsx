import type { ReactNode } from 'react';
import { Link } from 'react-router';

interface Props {
  title: string;
  /** The answer-first sentence. */
  headline: string;
  /** Where tapping the card goes (its full chart); none while that page does not exist. */
  to?: string;
  children?: ReactNode;
  testId: string;
  /** What opening the card does, for screen readers. */
  action?: string;
}

/** A dashboard card: question, answer, evidence. The whole card is one link when it has a
 * full chart, so there is a single tab stop and nothing inside competes with it. */
export function DashCard({
  title,
  headline,
  to,
  children,
  testId,
  action = 'Open the full chart.',
}: Props) {
  return (
    <section
      className={`relative flex flex-col rounded-xl border border-border bg-surface p-4 ${
        to ? 'transition-colors duration-200 hover:bg-surface-2' : ''
      }`}
      aria-label={title}
      data-testid={testId}
    >
      <h3 className="eyebrow">
        {to ? (
          <Link
            to={to}
            aria-label={`${title}: ${headline}. ${action}`}
            className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-accent"
          >
            {title}
          </Link>
        ) : (
          title
        )}
      </h3>
      <p
        className="mt-1 text-lg font-semibold tabular-nums leading-snug"
        data-testid={`${testId}-headline`}
      >
        {headline}
      </p>
      {children ? <div className="mt-3 flex-1">{children}</div> : null}
    </section>
  );
}
