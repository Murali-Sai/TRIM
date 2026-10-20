import type { Grouping } from './format';

const OPTIONS: readonly [Grouping, string][] = [
  ['day', 'Days'],
  ['week', 'Weeks'],
  ['month', 'Months'],
];

/** Days, or the average per day by week or month (with the on-target count). */
export function GroupToggle({
  value,
  onChange,
}: {
  value: Grouping;
  onChange: (g: Grouping) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Show"
      className="inline-grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1"
    >
      {OPTIONS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          className={`tap cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold transition-colors duration-200 ${
            value === key ? 'bg-surface text-text shadow-sm' : 'text-text-secondary'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
