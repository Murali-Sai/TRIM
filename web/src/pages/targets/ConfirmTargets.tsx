import { useEffect, useRef } from 'react';
import type { TargetValues } from '../../lib/targetsEditor';
import { formatNumber } from '../../lib/units';
import { primaryButton, secondaryButton } from '../account/Section';

interface Props {
  current: TargetValues | null;
  next: TargetValues;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ROWS: { key: keyof TargetValues; label: string; unit: string }[] = [
  { key: 'kcal', label: 'Calories', unit: 'kcal' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
];

/** "Use these targets?" with the current and new values side by side, before anything saves. */
export function ConfirmTargets({ current, next, saving, onConfirm, onCancel }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section
      aria-labelledby="confirm-heading"
      className="rounded-xl border-2 border-accent bg-surface p-4"
      data-testid="confirm-targets"
    >
      <h3 id="confirm-heading" ref={heading} tabIndex={-1} className="text-lg font-semibold">
        Use these targets?
      </h3>
      <table className="mt-3 w-full text-left">
        <thead>
          <tr className="border-b border-border text-sm text-text-secondary">
            <th scope="col" className="py-2 font-semibold">
              <span className="sr-only">Target</span>
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              Now
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              New
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(({ key, label, unit }) => (
            <tr key={key} className="border-b border-border last:border-0">
              <th scope="row" className="py-2 font-normal">
                {label}
              </th>
              <td className="py-2 text-right tabular-nums" data-testid={`old-${key}`}>
                {current ? `${formatNumber(current[key])} ${unit}` : 'None'}
              </td>
              <td className="py-2 text-right font-semibold tabular-nums" data-testid={`new-${key}`}>
                {formatNumber(next[key])} {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={onConfirm} disabled={saving} className={primaryButton}>
          {saving ? 'Saving' : 'Yes, use these'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={secondaryButton}>
          Keep my current targets
        </button>
      </div>
    </section>
  );
}
