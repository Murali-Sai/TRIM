import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../api/client';
import {
  addReadings,
  MEASUREMENT_TYPES_KEY,
  MEASUREMENTS_KEY,
  type MeasurementType,
  type ReadingInput,
} from '../../api/measurements';
import { formatNumber, parseDecimal } from '../../lib/units';
import { fromDisplay, toDisplay } from '../../lib/measureUnits';
import { ChangeTable } from '../measure/ChangeTable';
import { changeRows } from '../measure/rows';
import { sideName, useMeasurementData } from '../measure/useMeasurementData';
import { Notice, primaryButton, Section } from '../account/Section';

const link =
  'tap inline-block rounded-lg border border-border bg-surface px-4 py-2.5 font-semibold';

function fieldLabel(t: MeasurementType): string {
  return t.unit === 'text' ? sideName(t) : `${sideName(t)} (${t.unit})`;
}

/**
 * Body measurements on the Body page (SPEC page 4): a quick log for every switched-on metric
 * at once, the change since the first reading, and links to the charts and Manage metrics.
 */
export function MeasurementsSection({ timeZone }: { timeZone: string }) {
  const queryClient = useQueryClient();
  const data = useMeasurementData(timeZone);
  const types = data.metrics.flatMap((m) => m.types);
  const [values, setValues] = useState<Record<string, string>>({});
  const [bad, setBad] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const save = useMutation({
    mutationFn: (items: ReadingInput[]) => addReadings(items),
    onSuccess: async (rows) => {
      setValues({});
      setSaved(rows.length);
      await queryClient.invalidateQueries({ queryKey: MEASUREMENTS_KEY });
      await queryClient.invalidateQueries({ queryKey: MEASUREMENT_TYPES_KEY });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(null);
    const items: ReadingInput[] = [];
    for (const t of types) {
      const raw = (values[t.id] ?? '').trim();
      if (!raw) continue;
      if (t.unit === 'text') {
        items.push({ type_id: t.id, value_text: raw });
        continue;
      }
      const n = parseDecimal(raw);
      if (!(n > 0)) {
        setBad(`Enter a number above 0 for ${sideName(t)}.`);
        return;
      }
      items.push({ type_id: t.id, value: Math.round(fromDisplay(n, t.unit) * 1000) / 1000 });
    }
    if (items.length === 0) {
      setBad('Enter at least one measurement.');
      return;
    }
    setBad(null);
    save.mutate(items);
  }

  const rows = changeRows(data.metrics, data.readings);
  const error =
    bad ??
    (save.error
      ? (save.error instanceof ApiError && save.error.userMessage) || 'Could not save. Try again.'
      : null);

  return (
    <Section title="Measurements" testId="measurements-section">
      {types.length === 0 ? (
        <p className="mb-3 text-text-secondary">
          Track waist, hips, body fat or anything you like. Switch metrics on to log them.
        </p>
      ) : (
        <form onSubmit={submit} noValidate data-testid="quick-log">
          <div className="grid grid-cols-2 gap-3">
            {types.map((t) => {
              const last = t.latest;
              const hint =
                last?.value != null
                  ? formatNumber(toDisplay(last.value, t.unit), t.precision)
                  : (last?.value_text ?? '');
              return (
                <div key={t.id} className={t.unit === 'text' ? 'col-span-2' : ''}>
                  <label htmlFor={`m-${t.id}`} className="block text-sm font-semibold">
                    {fieldLabel(t)}
                  </label>
                  <input
                    id={`m-${t.id}`}
                    inputMode={t.unit === 'text' ? 'text' : 'decimal'}
                    autoComplete="off"
                    placeholder={hint}
                    value={values[t.id] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [t.id]: e.target.value }))}
                    className="tap num mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2"
                  />
                </div>
              );
            })}
          </div>
          {error ? <Notice kind="error">{error}</Notice> : null}
          {saved ? (
            <Notice kind="ok">
              {saved === 1 ? 'Saved 1 measurement.' : `Saved ${saved} measurements.`}
            </Notice>
          ) : null}
          <button
            type="submit"
            disabled={save.isPending}
            className={`${primaryButton} mt-3 w-full cursor-pointer`}
          >
            {save.isPending ? 'Saving' : 'Save measurements'}
          </button>
        </form>
      )}
      {rows.length > 0 ? (
        <div className="mt-4">
          <ChangeTable rows={rows} caption="Latest reading and change since your first" />
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        {rows.length > 0 ? (
          <Link to="/charts/measurements" className={link}>
            See charts
          </Link>
        ) : null}
        <Link to="/body/metrics" className={link}>
          Manage metrics
        </Link>
      </div>
    </Section>
  );
}
