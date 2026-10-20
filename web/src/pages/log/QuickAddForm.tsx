import { useState, type FormEvent } from 'react';
import type { QuickAdd } from '../../api/logs';
import { Field } from '../../components/Field';
import { readQuickAdd, type QuickDraft } from '../../lib/picked';
import { primaryButton } from '../account/Section';

const EMPTY: QuickDraft = { name: '', kcal: '', protein: '', fat: '', carbs: '' };

/** Calories (and macros if known) without a food, for when only the numbers matter. */
export function QuickAddForm({ onAdd }: { onAdd: (q: QuickAdd) => void }) {
  const [draft, setDraft] = useState(EMPTY);
  const [shown, setShown] = useState<ReturnType<typeof readQuickAdd>['errors']>({});
  const set = (k: keyof QuickDraft) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [k]: e.target.value });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = readQuickAdd(draft);
    setShown(r.errors);
    if (!r.value) return;
    onAdd(r.value);
    setDraft(EMPTY);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3" data-testid="quick-add">
      <Field
        id="qa-name"
        label="Name (optional)"
        autoComplete="off"
        maxLength={120}
        value={draft.name}
        onChange={set('name')}
        placeholder="Quick add"
      />
      <Field
        id="qa-kcal"
        label="Calories (kcal)"
        inputMode="decimal"
        autoComplete="off"
        value={draft.kcal}
        onChange={set('kcal')}
        error={shown.kcal}
      />
      <div className="grid grid-cols-3 gap-3">
        <Field
          id="qa-protein"
          label="Protein (g)"
          inputMode="decimal"
          autoComplete="off"
          value={draft.protein}
          onChange={set('protein')}
          error={shown.protein}
        />
        <Field
          id="qa-fat"
          label="Fat (g)"
          inputMode="decimal"
          autoComplete="off"
          value={draft.fat}
          onChange={set('fat')}
          error={shown.fat}
        />
        <Field
          id="qa-carbs"
          label="Carbs (g)"
          inputMode="decimal"
          autoComplete="off"
          value={draft.carbs}
          onChange={set('carbs')}
          error={shown.carbs}
        />
      </div>
      <div>
        <button type="submit" className={`${primaryButton} cursor-pointer`}>
          Add to list
        </button>
      </div>
    </form>
  );
}
