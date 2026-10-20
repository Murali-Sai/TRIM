import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { createCustomFood, type Food } from '../../api/foods';
import { Field } from '../../components/Field';
import { Sheet } from '../../components/Sheet';
import { emptyCustomDraft, readCustomFood, type CustomDraft } from '../../lib/picked';
import { formatNumber } from '../../lib/units';
import { Notice, primaryButton } from '../account/Section';

interface Props {
  /** Prefills the name, usually what was searched for. */
  name: string;
  onCreated: (food: Food) => void;
  onClose: () => void;
}

/** A private custom food from a label: per serving or per 100 g (SPEC: manual entry). */
export function CustomFoodSheet({ name, onCreated, onClose }: Props) {
  const [draft, setDraft] = useState<CustomDraft>(() => emptyCustomDraft(name));
  const [shown, setShown] = useState<ReturnType<typeof readCustomFood>['errors']>({});
  const read = readCustomFood(draft);
  const save = useMutation({ mutationFn: createCustomFood, onSuccess: onCreated });
  const set = (k: keyof CustomDraft) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [k]: e.target.value });
  const unit = draft.per === 'serving' ? 'per serving' : 'per 100 g';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setShown(read.errors);
    if (read.value) save.mutate(read.value);
  }

  const error = save.error
    ? (save.error instanceof ApiError && save.error.userMessage) ||
      'Could not save the food. Try again.'
    : null;

  return (
    <Sheet title="New custom food" onClose={onClose} testId="custom-food-sheet">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field
          id="cf-name"
          label="Name"
          autoComplete="off"
          maxLength={120}
          value={draft.name}
          onChange={set('name')}
          error={shown.name}
        />
        <Field
          id="cf-brand"
          label="Brand (optional)"
          autoComplete="off"
          maxLength={120}
          value={draft.brand}
          onChange={set('brand')}
        />

        <fieldset>
          <legend className="font-semibold">The label gives values</legend>
          <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
            {(['serving', '100g'] as const).map((p) => (
              <label
                key={p}
                className={`tap flex cursor-pointer items-center justify-center rounded-md px-3 py-2 font-semibold transition-colors duration-200 ${
                  draft.per === p ? 'bg-surface text-text shadow-sm' : 'text-text-secondary'
                }`}
              >
                <input
                  type="radio"
                  name="cf-per"
                  value={p}
                  checked={draft.per === p}
                  onChange={() => setDraft({ ...draft, per: p })}
                  className="sr-only"
                />
                {p === 'serving' ? 'Per serving' : 'Per 100 g'}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Field
            id="cf-serving"
            label={draft.per === 'serving' ? 'Serving' : 'Serving (optional)'}
            autoComplete="off"
            maxLength={60}
            value={draft.servingLabel}
            onChange={set('servingLabel')}
            error={shown.servingLabel}
          />
          <Field
            id="cf-serving-g"
            label="Serving weight (g)"
            inputMode="decimal"
            autoComplete="off"
            value={draft.servingGrams}
            onChange={set('servingGrams')}
            error={shown.servingGrams}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            id="cf-kcal"
            label={`Calories (${unit})`}
            inputMode="decimal"
            autoComplete="off"
            value={draft.kcal}
            onChange={set('kcal')}
            error={shown.kcal}
          />
          <Field
            id="cf-protein"
            label="Protein (g)"
            inputMode="decimal"
            autoComplete="off"
            value={draft.protein}
            onChange={set('protein')}
            error={shown.protein}
          />
          <Field
            id="cf-carbs"
            label="Carbs (g)"
            inputMode="decimal"
            autoComplete="off"
            value={draft.carbs}
            onChange={set('carbs')}
            error={shown.carbs}
          />
          <Field
            id="cf-fat"
            label="Fat (g)"
            inputMode="decimal"
            autoComplete="off"
            value={draft.fat}
            onChange={set('fat')}
            error={shown.fat}
          />
          <Field
            id="cf-fiber"
            label="Fiber (g, optional)"
            inputMode="decimal"
            autoComplete="off"
            value={draft.fiber}
            onChange={set('fiber')}
            error={shown.fiber}
          />
          <Field
            id="cf-sugar"
            label="Sugar (g, optional)"
            inputMode="decimal"
            autoComplete="off"
            value={draft.sugar}
            onChange={set('sugar')}
            error={shown.sugar}
          />
          <Field
            id="cf-sodium"
            label="Sodium (mg, optional)"
            inputMode="decimal"
            autoComplete="off"
            value={draft.sodium}
            onChange={set('sodium')}
            error={shown.sodium}
          />
        </div>

        {read.per100 && draft.per === 'serving' ? (
          <p className="num text-sm text-text-secondary" data-testid="cf-per100">
            {formatNumber(read.per100.kcal)} kcal per 100 g
          </p>
        ) : null}
        {read.mismatch ? (
          <p
            className="rounded-lg bg-surface-2 p-3 text-sm"
            role="status"
            data-testid="cf-mismatch"
          >
            The calories don&apos;t match protein, carbs and fat (4, 4 and 9 kcal per gram). Worth a
            second look at the label.
          </p>
        ) : null}
        {error ? <Notice kind="error">{error}</Notice> : null}
        <button
          type="submit"
          disabled={save.isPending}
          className={`${primaryButton} cursor-pointer`}
        >
          {save.isPending ? 'Saving' : 'Save food'}
        </button>
      </form>
    </Sheet>
  );
}
