import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { applyCalculation, saveCustomTargets, type TargetRow } from '../../api/setup';
import { Field } from '../../components/Field';
import { calculate, type CalcInput } from '../../lib/tdee';
import {
  carbsAsRest,
  editField,
  editorFrom,
  readEditor,
  type EditorField,
  type EditorRead,
  type TargetValues,
} from '../../lib/targetsEditor';
import { formatNumber } from '../../lib/units';
import { Notice, primaryButton, secondaryButton } from '../account/Section';

interface Props {
  initial: TargetValues;
  /** The calculator inputs "Reset to formula" recomputes from. Null hides the button. */
  formula: CalcInput | null;
  /** True when `initial` is the formula's own result, so saving it unchanged is not custom. */
  initialIsFormula: boolean;
  /** Sent with a custom save when nothing is saved yet (sign-up), so reset works later. */
  basis?: CalcInput;
  saveLabel?: string;
  onSaved: (row: TargetRow) => void;
  onCancel?: () => void;
}

const FIELDS: { field: EditorField; label: string; unit: string }[] = [
  { field: 'kcal', label: 'Calories', unit: 'kcal' },
  { field: 'protein', label: 'Protein', unit: 'g' },
  { field: 'fat', label: 'Fat', unit: 'g' },
  { field: 'carbs', label: 'Carbs', unit: 'g' },
];

function saveError(e: unknown): string | null {
  if (!e) return null;
  return (e instanceof ApiError && e.userMessage) || 'Could not save your targets. Try again.';
}

/**
 * Custom edits to calories and macros. Calorie, protein and fat edits recalculate carbs as the
 * rest until the user types carbs. Nothing is saved until the user taps Save.
 */
export function TargetsEditor({
  initial,
  formula,
  initialIsFormula,
  basis,
  saveLabel = 'Save targets',
  onSaved,
  onCancel,
}: Props) {
  const [state, setState] = useState(() => editorFrom(initial));
  const [fromFormula, setFromFormula] = useState(initialIsFormula);
  const [shown, setShown] = useState<EditorRead['errors']>({});
  const [resetNote, setResetNote] = useState(false);
  const read = readEditor(state);

  const save = useMutation({
    mutationFn: () => {
      if (fromFormula && formula) return applyCalculation(formula);
      const values = read.values;
      if (!values) throw new Error('invalid');
      return saveCustomTargets(basis ? { ...values, basis } : values);
    },
    onSuccess: onSaved,
  });

  function change(field: EditorField, raw: string) {
    setState((s) => editField(s, field, raw));
    setFromFormula(false);
    setResetNote(false);
  }

  function reset() {
    if (!formula) return;
    const r = calculate(formula);
    setState(
      editorFrom({
        kcal: r.target_kcal,
        protein_g: r.protein_g,
        fat_g: r.fat_g,
        carbs_g: r.carbs_g,
      }),
    );
    setFromFormula(true);
    setShown({});
    setResetNote(true);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setShown(read.errors);
    if (!read.values) return;
    save.mutate();
  }

  const kcal = read.values?.kcal;
  const sum = read.kcalFromMacros;
  // Rounded grams can re-add a few kcal off the target; only a real gap is worth a note.
  const gap = kcal !== undefined && sum !== null && Math.abs(sum - kcal) > 4;
  const error = saveError(save.error);

  return (
    <form onSubmit={onSubmit} noValidate data-testid="targets-editor">
      <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-2">
        {FIELDS.map(({ field, label, unit }) => (
          <Field
            key={field}
            id={`target-${field}`}
            label={`${label} (${unit})`}
            inputMode="numeric"
            autoComplete="off"
            value={state[field]}
            onChange={(e) => change(field, e.target.value)}
            error={shown[field]}
            hint={
              field === 'carbs' && !state.carbsEdited
                ? 'The rest of your calories'
                : field === 'carbs'
                  ? 'As you typed them'
                  : undefined
            }
          />
        ))}
      </div>
      {state.carbsEdited ? (
        <button
          type="button"
          onClick={() => {
            setState((s) => carbsAsRest(s));
            setFromFormula(false);
          }}
          className="tap mt-2 text-sm font-semibold text-accent underline"
        >
          Make carbs the rest again
        </button>
      ) : null}

      {read.clamped ? (
        <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm" role="status">
          Protein and fat already use your full calorie target. Lower them or raise calories.
        </p>
      ) : null}
      {gap && sum !== null && kcal !== undefined ? (
        <p className="mt-3 text-sm text-text-secondary" data-testid="macro-sum">
          Protein, fat and carbs add up to {formatNumber(sum)} kcal, not {formatNumber(kcal)}.
        </p>
      ) : null}
      {resetNote ? <Notice kind="ok">Formula values filled in. Save to use them.</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" disabled={save.isPending} className={primaryButton}>
          {save.isPending ? 'Saving' : saveLabel}
        </button>
        {formula ? (
          <button type="button" onClick={reset} className={secondaryButton}>
            Reset to formula
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
