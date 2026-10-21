import { useId } from 'react';

/** An on/off switch with a visible label and an optional hint, 44 px tall to tap. */
export function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="min-w-0 flex-1">
        <span id={`${id}-label`} className="block font-semibold">
          {label}
        </span>
        {hint ? (
          <span id={`${id}-hint`} className="block text-sm text-text-secondary">
            {hint}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="tap flex h-11 shrink-0 cursor-pointer items-center disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={`relative h-7 w-12 rounded-full transition-colors duration-200 ${
            checked ? 'bg-accent' : 'bg-border'
          }`}
        >
          <span
            className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-surface shadow transition-transform duration-200 motion-reduce:transition-none ${
              checked ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </span>
      </button>
    </div>
  );
}
