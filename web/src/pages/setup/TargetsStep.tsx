import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { applyCalculation } from '../../api/setup';
import {
  calculate,
  DEFAULT_DEFICIT,
  type CalcInput,
  type Deficit,
  type Plan,
} from '../../lib/tdee';
import { EstimateNotes, PlanChoice, ResultCard } from '../targets/ResultCard';
import { TargetsEditor } from '../targets/TargetsEditor';
import type { BodyStatsValues } from './bodyStatsDraft';

interface Props {
  stats: BodyStatsValues;
  onEditStats: () => void;
  onApplied: () => void;
}

export function TargetsStep({ stats, onEditStats, onApplied }: Props) {
  const suggested = calculate({ ...stats }).suggested_plan;
  const [plan, setPlan] = useState<Plan>(suggested);
  const [deficit, setDeficit] = useState<Deficit>(DEFAULT_DEFICIT);
  const [adjusting, setAdjusting] = useState(false);
  const input: CalcInput = {
    sex: stats.sex,
    age: stats.age,
    weight_kg: stats.weight_kg,
    height_cm: stats.height_cm,
    activity: stats.activity,
    plan,
    deficit_kcal: deficit,
  };
  const r = calculate(input);

  const apply = useMutation({ mutationFn: applyCalculation, onSuccess: onApplied });

  const serverError =
    apply.error instanceof ApiError
      ? (apply.error.userMessage ?? 'Could not save your targets. Try again.')
      : apply.error
        ? 'Something went wrong. Try again.'
        : null;

  if (adjusting) {
    return (
      <div>
        <p className="text-sm text-text-secondary">Step 3 of 3</p>
        <h2 className="mt-1 text-2xl font-bold">Adjust your targets</h2>
        <p className="mt-2 mb-4 text-text-secondary">
          Change calories or any macro. Carbs fill the rest of your calories unless you change them
          too.
        </p>
        <TargetsEditor
          initial={{
            kcal: r.target_kcal,
            protein_g: r.protein_g,
            fat_g: r.fat_g,
            carbs_g: r.carbs_g,
          }}
          formula={input}
          initialIsFormula
          basis={input}
          saveLabel="Use these targets"
          onSaved={onApplied}
          onCancel={() => setAdjusting(false)}
        />
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-text-secondary">Step 3 of 3</p>
      <h2 className="mt-1 text-2xl font-bold">Your targets</h2>

      <PlanChoice
        result={r}
        plan={plan}
        deficit={deficit}
        units={stats.unit_system}
        onPlan={setPlan}
        onDeficit={setDeficit}
      />

      <ResultCard result={r} />

      <EstimateNotes />

      {serverError ? (
        <p className="mt-4 rounded-lg border border-border bg-surface-2 p-3 text-sm" role="alert">
          {serverError}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => apply.mutate(input)}
          disabled={apply.isPending}
          className="tap rounded-lg bg-accent px-4 py-3 font-semibold text-accent-contrast disabled:opacity-60"
        >
          {apply.isPending ? 'Saving' : 'Use these targets'}
        </button>
        <button
          type="button"
          onClick={() => setAdjusting(true)}
          className="tap rounded-lg border border-border bg-surface px-4 py-3 font-semibold"
        >
          Adjust
        </button>
        <button
          type="button"
          onClick={onEditStats}
          className="tap rounded-lg px-4 py-2 text-sm font-semibold text-accent underline"
        >
          Change my details
        </button>
      </div>
    </div>
  );
}
