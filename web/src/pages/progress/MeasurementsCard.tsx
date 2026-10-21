import { measurementHeadline } from '../../lib/chart/headlines';
import { ChangeTable } from '../measure/ChangeTable';
import { changeRows } from '../measure/rows';
import { useMeasurementData } from '../measure/useMeasurementData';
import { DashCard } from './DashCard';

/**
 * "What has changed?" (SPEC page 4, Progress dashboard): the active metrics' latest readings
 * and change since start, headed by the one that moved most ("Waist down 2.7 cm since 1 Sep").
 */
export function MeasurementsCard({ timeZone }: { timeZone: string }) {
  const data = useMeasurementData(timeZone);
  if (data.isPending)
    return <DashCard title="Body measurements" headline=" " testId="card-measurements" />;
  const rows = changeRows(data.metrics, data.readings);
  if (rows.length === 0) {
    return (
      <DashCard
        title="Body measurements"
        headline={
          data.metrics.length
            ? 'Log a measurement to see what changes'
            : 'No measurements tracked yet'
        }
        to={data.metrics.length ? '/body' : '/body/metrics'}
        testId="card-measurements"
      >
        <p className="text-sm text-text-secondary">
          Waist, hips, body fat or your own metrics, with the change since you started.
        </p>
      </DashCard>
    );
  }
  const moved = [...rows]
    .filter((r) => r.pct !== null)
    .sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0))[0];
  let headline = `${rows[0]?.name ?? 'Measurements'}: first reading logged`;
  if (moved?.since) {
    const t = data.metrics.flatMap((m) => m.types).find((x) => x.id === moved.key);
    // A percentage metric moves in percentage points.
    const unit = t?.unit === '%' ? 'points' : (t?.unit ?? '');
    const change = (moved.values.at(-1) ?? 0) - (moved.values[0] ?? 0);
    headline = measurementHeadline({ metric: moved.name, change, unit, since: moved.since });
  }
  return (
    <DashCard
      title="Body measurements"
      headline={headline}
      to="/charts/measurements"
      testId="card-measurements"
    >
      <ChangeTable rows={rows.slice(0, 3)} caption="Latest reading and change since your first" />
    </DashCard>
  );
}
