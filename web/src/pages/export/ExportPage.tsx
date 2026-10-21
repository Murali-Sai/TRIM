import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMe } from '../../api/auth';
import { ApiError } from '../../api/client';
import {
  DATASETS,
  downloadExport,
  type DatasetKey,
  type ExportFormat,
  type ExportRequest,
} from '../../api/export';
import { Field } from '../../components/Field';
import { exportDates, RANGE_CHOICES, type RangeChoice } from '../../lib/exportRange';
import { isoToZonedWall } from '../../lib/zoned';
import { usePageTitle } from '../../usePageTitle';
import { Notice, primaryButton, secondaryButton, Section } from '../account/Section';

const FORMATS: readonly [ExportFormat, string, string][] = [
  ['xlsx', 'Excel (.xlsx)', 'One sheet per dataset, in your units.'],
  ['csv', 'CSV', 'A zip with one file per dataset.'],
  ['json', 'JSON', 'Stored units and ids, the format TRIM can import.'],
];
const ALL: DatasetKey[] = DATASETS.map(([k]) => k);

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 404) return 'No data in this range.';
  return (e instanceof ApiError && e.userMessage) || 'Could not prepare your file. Try again.';
}

/** Download my data (SPEC page 4): format, date range and datasets, then Download. */
export function ExportPage() {
  usePageTitle('Download my data');
  const me = useMe();
  if (!me.data) return null;
  return (
    <section>
      <Link to="/account" className="tap text-sm font-semibold text-accent underline">
        Account
      </Link>
      <h2 className="mt-2 text-2xl font-bold">Download my data</h2>
      <p className="mt-2 max-w-prose text-text-secondary">
        Everything you have logged, made on the spot from your own data. The file is not kept on our
        servers.
      </p>
      <div className="mt-4 max-w-2xl">
        <ExportForm timeZone={me.data.timezone} />
      </div>
    </section>
  );
}

export function ExportForm({ timeZone }: { timeZone: string }) {
  const id = useId();
  const today = isoToZonedWall(new Date().toISOString(), timeZone).slice(0, 10);
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [range, setRange] = useState<RangeChoice>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(today);
  const [picked, setPicked] = useState<Set<DatasetKey>>(() => new Set(ALL));
  const [bad, setBad] = useState<string | null>(null);

  const download = useMutation({
    mutationFn: (req: ExportRequest) => downloadExport(req, today),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    download.reset();
    if (picked.size === 0) return setBad('Pick at least one dataset.');
    if (range === 'custom' && from && to && from > to) {
      return setBad('The start date is after the end date.');
    }
    setBad(null);
    download.mutate({
      format,
      ...exportDates(range, today, { from, to }),
      datasets: ALL.filter((k) => picked.has(k)),
    });
  }

  function toggle(k: DatasetKey, on: boolean) {
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });
  }

  const message = bad ?? (download.error ? errorText(download.error) : null);
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" data-testid="export-form">
      <Section title="Format">
        <fieldset>
          <legend className="sr-only">Format</legend>
          <div className="flex flex-col gap-2">
            {FORMATS.map(([value, label, hint]) => (
              <label
                key={value}
                className={`tap flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-200 ${
                  format === value
                    ? 'border-accent bg-surface-2'
                    : 'border-border hover:bg-surface-2'
                }`}
              >
                <input
                  type="radio"
                  name={`${id}-format`}
                  value={value}
                  checked={format === value}
                  onChange={() => setFormat(value)}
                  className="mt-1 accent-[var(--color-accent)]"
                />
                <span>
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-sm text-text-secondary">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Section>

      <Section title="Date range">
        <label htmlFor={`${id}-range`} className="sr-only">
          Date range
        </label>
        <select
          id={`${id}-range`}
          value={range}
          onChange={(e) => setRange(e.target.value as RangeChoice)}
          className="tap w-full rounded-lg border border-border bg-surface px-3 py-2.5 sm:w-64"
        >
          {RANGE_CHOICES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {range === 'custom' ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              id={`${id}-from`}
              label="From"
              type="date"
              value={from}
              max={to || today}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Field
              id={`${id}-to`}
              label="To"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        ) : null}
        <p className="mt-2 text-sm text-text-secondary">
          Saved meals, staples, custom foods and your profile always come whole.
        </p>
      </Section>

      <Section title="Datasets">
        <fieldset>
          <legend className="sr-only">Datasets</legend>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              className={`${secondaryButton} cursor-pointer text-sm`}
              onClick={() => setPicked(new Set(ALL))}
            >
              Select all
            </button>
            <button
              type="button"
              className={`${secondaryButton} cursor-pointer text-sm`}
              onClick={() => setPicked(new Set())}
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {DATASETS.map(([key, label]) => (
              <label key={key} className="tap flex cursor-pointer items-center gap-3 py-1">
                <input
                  type="checkbox"
                  checked={picked.has(key)}
                  onChange={(e) => toggle(key, e.target.checked)}
                  className="h-5 w-5 accent-[var(--color-accent)]"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </Section>

      {message ? <Notice kind="error">{message}</Notice> : null}
      {download.isSuccess ? <Notice kind="ok">Downloaded {download.data}.</Notice> : null}
      <button
        type="submit"
        disabled={download.isPending}
        className={`${primaryButton} cursor-pointer sm:self-start`}
      >
        {download.isPending ? 'Preparing your file' : 'Download'}
      </button>
    </form>
  );
}
