import { forwardRef, useState, type ReactNode } from 'react';
import { rangeLabel } from '../../lib/chart/headlines';
import type { RangeKey } from '../../lib/weightChart';
import { secondaryButton } from '../../pages/account/Section';

export interface TableSpec {
  /** Read by screen readers; usually the chart's aria-label. */
  caption: string;
  columns: readonly string[];
  /** One array of cells per row, newest first. */
  rows: readonly (readonly ReactNode[])[];
  /** Columns holding numbers are right-aligned in Fira Code. */
  numeric?: readonly number[];
}

/** The same data as the chart, as a plain table (SPEC page 4, Accessibility). */
export function DataTable({ caption, columns, rows, numeric = [] }: TableSpec) {
  const align = (i: number) => (numeric.includes(i) ? 'num text-right' : '');
  return (
    <div className="max-h-96 overflow-auto" data-testid="chart-table">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((c, i) => (
              <th key={c} scope="col" className={`py-2 pr-2 last:pr-0 ${align(i)}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-border">
              {row.map((cell, i) => (
                <td key={i} className={`py-2 pr-2 last:pr-0 ${align(i)}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Range chips 1W to All, as a radio group with spoken names ("last month"). */
export function RangeChips({
  value,
  options,
  onChange,
}: {
  value: RangeKey;
  options: readonly RangeKey[];
  onChange: (r: RangeKey) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Time range" className="flex flex-wrap gap-1">
      {options.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          aria-label={rangeLabel(r)}
          className={`tap min-w-11 cursor-pointer rounded-lg px-2 py-2 text-sm font-semibold transition-colors duration-200 ${
            value === r ? 'bg-accent text-accent-contrast' : 'bg-surface-2 hover:bg-border'
          }`}
          onClick={() => onChange(r)}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

/** "Log 3 more weigh-ins to see your trend" in place of an empty chart. */
export function TooLittleData({ message }: { message: string }) {
  return (
    <div
      className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-text-secondary"
      data-testid="too-little-data"
    >
      <p>{message}</p>
    </div>
  );
}

/** The element a canvas chart draws into: an image with the headline as its label. */
export const ChartHost = forwardRef<HTMLDivElement, { label: string; testId?: string }>(
  function ChartHost({ label, testId }, ref) {
    return <div ref={ref} role="img" aria-label={label} data-testid={testId} />;
  },
);

interface FrameProps {
  /** The chart (usually a ChartHost and its tooltip). Kept mounted while the table shows. */
  children: ReactNode;
  table: TableSpec;
  /** When set, shown instead of the chart and table. */
  tooLittle?: string | null;
  range?: { value: RangeKey; options: readonly RangeKey[]; onChange: (r: RangeKey) => void };
  /** More buttons beside "View as table" (an info button, "Reset zoom"). */
  controls?: ReactNode;
  /** A short key under the chart, in words ("Bars are days, the line is your target"). */
  note?: ReactNode;
}

/** Controls, the chart or its table, and a note: the same frame for every chart. */
export function ChartFrame({ children, table, tooLittle, range, controls, note }: FrameProps) {
  const [asTable, setAsTable] = useState(false);
  if (tooLittle) return <TooLittleData message={tooLittle} />;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {range ? <RangeChips {...range} /> : null}
        <div className="ml-auto flex gap-2">
          {controls}
          <button
            type="button"
            className={`${secondaryButton} cursor-pointer text-sm`}
            aria-pressed={asTable}
            onClick={() => setAsTable((t) => !t)}
          >
            {asTable ? 'View as chart' : 'View as table'}
          </button>
        </div>
      </div>
      <div className={asTable ? 'hidden' : 'relative mt-3'}>
        {children}
        {note ? <p className="mt-2 text-xs text-text-secondary">{note}</p> : null}
      </div>
      {asTable ? (
        <div className="mt-3">
          <DataTable {...table} />
        </div>
      ) : null}
    </div>
  );
}

/** The sentence tooltip box a chart positions with placeTooltip. */
export const ChartTooltip = forwardRef<HTMLDivElement, { testId?: string }>(function ChartTooltip(
  { testId },
  ref,
) {
  return (
    <div
      ref={ref}
      hidden
      aria-hidden="true"
      data-testid={testId}
      className="pointer-events-none absolute top-0 z-10 max-w-[90%] rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow"
    />
  );
});
