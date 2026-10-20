import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { saveBodyStats, type BodyStats } from '../../api/setup';
import { BodyStatsFields } from './BodyStatsFields';
import { draftFrom, readDraft, type BodyStatsErrors, type BodyStatsValues } from './bodyStatsDraft';

export type { BodyStatsValues };

interface Props {
  initial: BodyStats;
  onSaved: (values: BodyStatsValues) => void;
}

export function BodyStatsStep({ initial, onSaved }: Props) {
  const [draft, setDraft] = useState(() =>
    draftFrom({
      ...initial,
      weight_kg: initial.latest_weight_kg,
      activity: initial.activity_level,
    }),
  );
  const [errors, setErrors] = useState<BodyStatsErrors>({});

  const save = useMutation({ mutationFn: saveBodyStats });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { values, errors: found } = readDraft(draft);
    setErrors(found);
    if (!values) return;
    save.mutate(
      {
        sex: values.sex,
        age: values.age,
        height_cm: values.height_cm,
        activity_level: values.activity,
        unit_system: values.unit_system,
        weight_kg: values.weight_kg,
      },
      { onSuccess: () => onSaved(values) },
    );
  }

  const serverError =
    save.error instanceof ApiError
      ? (save.error.userMessage ?? 'Check the fields above and try again.')
      : save.error
        ? 'Something went wrong. Try again.'
        : null;

  return (
    <form onSubmit={onSubmit} noValidate>
      <p className="text-sm text-text-secondary">Step 2 of 3</p>
      <h2 className="mt-1 text-2xl font-bold">About you</h2>
      <p className="mt-2 text-text-secondary">
        These give you starting targets from a standard formula.
      </p>

      <BodyStatsFields draft={draft} errors={errors} onChange={setDraft} />

      {serverError ? (
        <p className="mt-4 rounded-lg border border-border bg-surface-2 p-3 text-sm" role="alert">
          {serverError}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={save.isPending}
        className="tap mt-6 w-full rounded-lg bg-accent px-4 py-3 font-semibold text-accent-contrast disabled:opacity-60"
      >
        {save.isPending ? 'Saving' : 'Continue'}
      </button>
    </form>
  );
}
