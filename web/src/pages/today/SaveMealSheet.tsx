import { useId, useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import { Sheet } from '../../components/Sheet';
import { Notice, primaryButton } from '../account/Section';

interface Props {
  /** How many entries, and how many are quick adds (which have no food to save). */
  count: number;
  quickAdds: number;
  busy: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onClose: () => void;
}

/** Name a time block or a selection and save its foods and amounts as a meal. */
export function SaveMealSheet({ count, quickAdds, busy, error, onSave, onClose }: Props) {
  const id = useId();
  const [name, setName] = useState('');
  const [missing, setMissing] = useState(false);
  const foods = count - quickAdds;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setMissing(true);
      return;
    }
    onSave(name.trim());
  }

  return (
    <Sheet title="Save as meal" onClose={onClose} testId="save-meal-sheet">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field
          id={`${id}-name`}
          label="Meal name"
          value={name}
          maxLength={80}
          autoComplete="off"
          placeholder="Post-workout lunch"
          onChange={(e) => {
            setName(e.target.value);
            setMissing(false);
          }}
          error={missing ? 'Enter a name.' : null}
        />
        <p className="text-sm text-text-secondary">
          {foods === 1 ? '1 food' : `${foods} foods`} with the amounts you logged.
          {quickAdds > 0
            ? ` ${quickAdds === 1 ? '1 quick add is' : `${quickAdds} quick adds are`} left out, since there is no food to save.`
            : ''}
        </p>
        {error ? <Notice kind="error">{error}</Notice> : null}
        <button
          type="submit"
          disabled={busy || foods === 0}
          className={`${primaryButton} cursor-pointer`}
        >
          {busy ? 'Saving' : 'Save meal'}
        </button>
      </form>
    </Sheet>
  );
}
