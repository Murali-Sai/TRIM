import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { saveCustomTargets, TARGETS_KEY, type TargetRow } from '../../api/setup';
import { getSettings, SETTINGS_KEY } from '../../api/tracking';
import { Field } from '../../components/Field';
import { fiberDefault } from '../../lib/tdee';
import { formatNumber } from '../../lib/units';
import { formatWater, mlToFlOz, parseWater } from '../../lib/water';
import { Notice, primaryButton, Section } from '../account/Section';

/** Fiber (default 14 g per 1,000 kcal) and an optional water target. Saved as a new target row
 * with the current calories and macros, like any other edit. */
export function FiberWaterSection({ current }: { current: TargetRow }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: getSettings });
  const unit = settings.data?.water_unit ?? 'ml';
  const suggested = fiberDefault(current.kcal);
  const shownWater = (ml: number | null) =>
    ml === null ? '' : String(unit === 'ml' ? ml : Math.round(mlToFlOz(ml)));
  const [fiber, setFiber] = useState(String(current.fiber_g ?? suggested));
  const [water, setWater] = useState(shownWater(current.water_ml));
  const [errors, setErrors] = useState<{ fiber?: string; water?: string }>({});
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (v: { fiber_g: number; water_ml: number | null }) =>
      saveCustomTargets({
        kcal: current.kcal,
        protein_g: current.protein_g,
        fat_g: current.fat_g,
        carbs_g: current.carbs_g,
        ...v,
      }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: TARGETS_KEY });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const found: typeof errors = {};
    const f = Number(fiber.trim());
    if (!/^\d+$/.test(fiber.trim()) || f > 200) found.fiber = 'Enter whole grams from 0 to 200.';
    const ml = water.trim() === '' ? null : parseWater(water, unit);
    if (water.trim() !== '' && (ml === null || ml < 250))
      found.water =
        unit === 'ml'
          ? 'Enter 250 to 5,000 ml, or leave it empty.'
          : 'Enter 9 to 169 fl oz, or leave it empty.';
    setErrors(found);
    if (found.fiber || found.water) return;
    save.mutate({ fiber_g: f, water_ml: ml });
  }

  const error = save.error
    ? (save.error instanceof ApiError && save.error.userMessage) ||
      'Could not save. Check your connection and try again.'
    : null;

  return (
    <Section
      title="Fiber and water"
      description={`Fiber starts at 14 g per 1,000 kcal: ${formatNumber(suggested)} g for your ${formatNumber(current.kcal)} kcal. Water has no default; leave it empty for none.`}
    >
      <form
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-3"
        data-testid="fiber-water"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            id="target-fiber"
            label="Fiber (g)"
            inputMode="numeric"
            autoComplete="off"
            value={fiber}
            onChange={(e) => setFiber(e.target.value)}
            error={errors.fiber}
          />
          <Field
            id="target-water"
            label={`Water (${unit === 'ml' ? 'ml' : 'fl oz'})`}
            inputMode="decimal"
            autoComplete="off"
            value={water}
            onChange={(e) => setWater(e.target.value)}
            error={errors.water}
            hint={
              current.water_ml !== null && unit === 'fl_oz'
                ? `Saved as ${formatWater(current.water_ml, 'ml')}.`
                : undefined
            }
          />
        </div>
        {fiber !== String(suggested) ? (
          <button
            type="button"
            onClick={() => setFiber(String(suggested))}
            className="tap w-fit cursor-pointer text-sm font-semibold text-accent underline"
          >
            Use the default ({formatNumber(suggested)} g)
          </button>
        ) : null}
        {error ? <Notice kind="error">{error}</Notice> : null}
        {saved ? <Notice kind="ok">Fiber and water saved.</Notice> : null}
        <button
          type="submit"
          disabled={save.isPending}
          className={`${primaryButton} w-fit cursor-pointer`}
        >
          {save.isPending ? 'Saving' : 'Save fiber and water'}
        </button>
      </form>
    </Section>
  );
}
