import { shortDate } from '../../lib/chart/headlines';
import type { ChangeRow } from './rows';

/** A tiny line of the readings, drawn in the metric's series color. Decorative. */
export function Sparkline({ values, color }: { values: readonly number[]; color: string }) {
  if (values.length < 2)
    return <span className="inline-block h-5 w-10 sm:w-16" aria-hidden="true" />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 62 + 1},${19 - ((v - lo) / span) * 18}`)
    .join(' ');
  return (
    <svg
      viewBox="0 0 64 20"
      width="64"
      height="20"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-5 w-10 shrink-0 sm:w-16"
    >
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowGlyph({ dir }: { dir: 'up' | 'down' | 'flat' }) {
  const d = dir === 'up' ? 'M5 1 9 7H1Z' : dir === 'down' ? 'M5 9 1 3h8Z' : 'M1 5h8';
  return (
    <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" className="shrink-0">
      <path d={d} fill={dir === 'flat' ? 'none' : 'currentColor'} stroke="currentColor" />
    </svg>
  );
}

/** The "change since start" table: latest, change with an arrow, and a tiny sparkline. */
export function ChangeTable({ rows, caption }: { rows: readonly ChangeRow[]; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" data-testid="change-table">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-text-secondary">
          <tr>
            <th scope="col" className="py-1 pr-2 font-semibold">
              Metric
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-semibold">
              Latest
            </th>
            <th scope="col" className="py-1 pr-2 font-semibold">
              Change since start
            </th>
            <th scope="col" className="py-1">
              <span className="sr-only">Readings over time</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border" data-testid="change-row">
              <th scope="row" className="py-2 pr-2 font-semibold">
                {r.name}
              </th>
              <td className="num whitespace-nowrap py-2 pr-2 text-right">{r.latest}</td>
              <td className="py-2 pr-2">
                <span className="num inline-flex items-center gap-1 whitespace-nowrap">
                  <ArrowGlyph dir={r.dir} />
                  {r.change}
                </span>
                {r.since ? (
                  <span className="block text-xs text-text-secondary">
                    since {shortDate(r.since)}
                  </span>
                ) : null}
              </td>
              <td className="py-2">
                <Sparkline values={r.values} color={r.color} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
