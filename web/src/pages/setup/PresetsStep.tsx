import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { asMetrics, editType, listTypes, MEASUREMENT_TYPES_KEY } from '../../api/measurements';
import { Notice, primaryButton, secondaryButton } from '../account/Section';

/** Step 4 (skippable): which preset measurements to track. Any can be switched on later. */
export function PresetsStep({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const types = useQuery({ queryKey: MEASUREMENT_TYPES_KEY, queryFn: () => listTypes(false) });
  const presets = asMetrics((types.data ?? []).filter((t) => t.is_preset));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const save = useMutation({
    mutationFn: async () => {
      for (const m of presets) {
        const first = m.types[0];
        if (first && picked.has(m.key)) await editType(first.id, { is_active: true });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MEASUREMENT_TYPES_KEY });
      onDone();
    },
  });

  return (
    <div>
      <p className="text-sm text-text-secondary">Step 4 of 4, optional</p>
      <h2 className="mt-1 text-2xl font-bold">Track any measurements?</h2>
      <p className="mt-2 text-text-secondary">
        Pick the ones you want to log. You can add your own, or change these, any time.
      </p>
      {types.isError ? (
        <Notice kind="error">Could not load the measurements. You can skip for now.</Notice>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Measurements">
        {presets.map((m) => {
          const on = picked.has(m.key);
          return (
            <button
              key={m.key}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setPicked((p) => {
                  const next = new Set(p);
                  if (on) next.delete(m.key);
                  else next.add(m.key);
                  return next;
                })
              }
              className={`tap cursor-pointer rounded-full border px-4 py-2 font-semibold transition-colors duration-200 ${
                on ? 'border-accent bg-surface-2' : 'border-border'
              }`}
            >
              {m.name}
              {m.types.length === 2 ? (
                <span className="font-normal text-text-secondary"> (left and right)</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {save.isError ? <Notice kind="error">Could not save. Try again, or skip.</Notice> : null}
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={picked.size === 0 || save.isPending}
          className={`${primaryButton} cursor-pointer`}
        >
          {save.isPending
            ? 'Saving'
            : picked.size
              ? `Track ${picked.size === 1 ? '1 measurement' : `${picked.size} measurements`}`
              : 'Pick at least one'}
        </button>
        <button type="button" onClick={onDone} className={`${secondaryButton} cursor-pointer`}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
