import { tdeeByActivity } from '../../lib/targetsEditor';
import type { ActivityLevel, Sex } from '../../lib/tdee';
import { formatNumber } from '../../lib/units';

interface Props {
  input: { sex: Sex; age: number; weight_kg: number; height_cm: number };
  selected: ActivityLevel;
}

/** Maintenance calories at all five activity levels, so the effect of the choice is visible. */
export function TdeeTable({ input, selected }: Props) {
  const rows = tdeeByActivity(input);
  return (
    <table className="w-full text-left text-sm" data-testid="tdee-table">
      <caption className="mb-2 text-left font-semibold">Maintenance at each activity level</caption>
      <thead>
        <tr className="border-b border-border text-text-secondary">
          <th scope="col" className="py-2 pr-2 font-semibold">
            Activity level
          </th>
          <th scope="col" className="py-2 text-right font-semibold">
            kcal a day
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const current = r.value === selected;
          return (
            <tr
              key={r.value}
              className={`border-b border-border last:border-0 ${current ? 'font-semibold' : ''}`}
              aria-current={current ? 'true' : undefined}
            >
              <th scope="row" className="py-2 pr-2 font-normal">
                <span className={current ? 'font-semibold' : ''}>{r.label}</span>
                {current ? <span className="ml-2 text-text-secondary">(yours)</span> : null}
              </th>
              <td className="py-2 text-right tabular-nums">{formatNumber(r.tdee)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
