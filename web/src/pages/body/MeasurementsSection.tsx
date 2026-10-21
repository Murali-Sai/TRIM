import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { asMetrics, listTypes, MEASUREMENT_TYPES_KEY } from '../../api/measurements';
import { Section } from '../account/Section';

const link =
  'tap inline-block rounded-lg border border-border bg-surface px-4 py-2.5 font-semibold';

/** Body measurements on the Body page: what is tracked, and the way to manage it. */
export function MeasurementsSection() {
  const types = useQuery({
    queryKey: [...MEASUREMENT_TYPES_KEY, 'live'],
    queryFn: () => listTypes(false),
  });
  const on = asMetrics((types.data ?? []).filter((t) => t.is_active));
  return (
    <Section title="Measurements" testId="measurements-section">
      {on.length === 0 ? (
        <p className="mb-3 text-text-secondary">
          Track waist, hips, body fat or anything you like. Switch metrics on to log them.
        </p>
      ) : (
        <p className="mb-3 text-text-secondary">Tracking {on.map((m) => m.name).join(', ')}.</p>
      )}
      <Link to="/body/metrics" className={link}>
        Manage metrics
      </Link>
    </Section>
  );
}
