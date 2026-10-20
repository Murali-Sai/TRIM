import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UnitSystem } from '../api/auth';
import { useMe } from '../api/auth';
import { ApiError } from '../api/client';
import {
  applyCalculation,
  BODY_STATS_KEY,
  getBodyStats,
  listTargets,
  TARGETS_KEY,
  type BodyStats,
  type TargetRow,
} from '../api/setup';
import { listWeights, WEIGHTS_KEY } from '../api/weights';
import {
  calculate,
  DEFAULT_DEFICIT,
  roundHalfUp,
  type CalcInput,
  type Deficit,
  type Plan,
} from '../lib/tdee';
import { formatNumber, kgToLb } from '../lib/units';
import { usePageTitle } from '../usePageTitle';
import { Notice, primaryButton, secondaryButton, Section } from './account/Section';
import { latestTrendKg } from './body/weightFormat';
import { BodyStatsFields } from './setup/BodyStatsFields';
import {
  draftFrom,
  readDraft,
  type BodyStatsDraft,
  type BodyStatsErrors,
} from './setup/bodyStatsDraft';
import { ConfirmTargets } from './targets/ConfirmTargets';
import { EstimateNotes, PlanChoice, ResultCard } from './targets/ResultCard';
import { TargetsEditor } from './targets/TargetsEditor';
import { TdeeTable } from './targets/TdeeTable';

export const TARGETS_SAVED = 'targets-saved';

interface Prefill {
  draft: BodyStatsDraft;
  trendKg: number | null;
  current: TargetRow | null;
}

function prefillFrom(
  stats: BodyStats,
  trendKg: number | null,
  units: UnitSystem,
  current: TargetRow | null,
): Prefill {
  const kg = trendKg ?? stats.latest_weight_kg;
  return {
    draft: draftFrom({
      unit_system: units,
      sex: stats.sex,
      age: stats.age,
      weight_kg: kg === null ? null : roundHalfUp(kg, 1),
      height_cm: stats.height_cm,
      activity: stats.activity_level,
    }),
    trendKg,
    current,
  };
}

/** The TDEE calculator (SPEC page 4): recalculate from the profile and the latest trend weight. */
export function CalculatorPage() {
  usePageTitle('TDEE calculator');
  const me = useMe();
  const stats = useQuery({ queryKey: BODY_STATS_KEY, queryFn: getBodyStats });
  const weights = useQuery({ queryKey: WEIGHTS_KEY, queryFn: listWeights });
  const targets = useQuery({ queryKey: TARGETS_KEY, queryFn: listTargets });

  return (
    <section>
      <p>
        <Link to="/targets" className="text-sm font-semibold text-accent underline">
          Targets
        </Link>
      </p>
      <h2 className="mt-1 text-2xl font-bold">TDEE calculator</h2>
      {stats.isError || weights.isError || targets.isError ? (
        <Notice kind="error">Could not load your details. Try again in a moment.</Notice>
      ) : me.data && stats.data && weights.data && targets.data ? (
        <Calculator
          prefill={prefillFrom(
            stats.data,
            latestTrendKg(weights.data),
            me.data.unit_system,
            targets.data[0] ?? null,
          )}
        />
      ) : (
        <div className="min-h-40" aria-busy="true" />
      )}
    </section>
  );
}

function Calculator({ prefill }: { prefill: Prefill }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(prefill.draft);
  const [errors, setErrors] = useState<BodyStatsErrors>({});
  const [calculated, setCalculated] = useState(() => readDraft(prefill.draft).values);
  const [plan, setPlan] = useState<Plan | null>(prefill.current?.formula?.plan ?? null);
  const [deficit, setDeficit] = useState<Deficit>(
    prefill.current?.formula?.deficit_kcal ?? DEFAULT_DEFICIT,
  );
  const [stage, setStage] = useState<'result' | 'confirm' | 'adjust'>('result');

  const done = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: TARGETS_KEY }),
      queryClient.invalidateQueries({ queryKey: BODY_STATS_KEY }),
    ]);
    navigate('/targets', { state: { [TARGETS_SAVED]: true } });
  };
  const apply = useMutation({ mutationFn: applyCalculation, onSuccess: done });

  function onCalculate(e: FormEvent) {
    e.preventDefault();
    const { values, errors: found } = readDraft(draft);
    setErrors(found);
    setCalculated(values);
    setStage('result');
  }

  function onReset() {
    setDraft(prefill.draft);
    setErrors({});
    setCalculated(readDraft(prefill.draft).values);
    setPlan(prefill.current?.formula?.plan ?? null);
    setDeficit(prefill.current?.formula?.deficit_kcal ?? DEFAULT_DEFICIT);
    setStage('result');
  }

  const input: CalcInput | null = calculated
    ? {
        sex: calculated.sex,
        age: calculated.age,
        weight_kg: calculated.weight_kg,
        height_cm: calculated.height_cm,
        activity: calculated.activity,
        ...(plan ? { plan } : {}),
        deficit_kcal: deficit,
      }
    : null;
  const r = input ? calculate(input) : null;
  const chosen: CalcInput | null = input && r ? { ...input, plan: r.plan } : null;
  const units = draft.units;
  const trendNote =
    prefill.trendKg !== null
      ? `Weight is your latest trend weight, ${
          units === 'imperial'
            ? `${formatNumber(kgToLb(prefill.trendKg), 1)} lb`
            : `${formatNumber(prefill.trendKg, 1)} kg`
        }.`
      : null;
  const current = prefill.current;
  const applyError = apply.error
    ? (apply.error instanceof ApiError && apply.error.userMessage) ||
      'Could not save your targets. Try again.'
    : null;

  return (
    <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
      <Section title="Your details">
        <form onSubmit={onCalculate} noValidate>
          {trendNote ? (
            <p className="mb-4 text-sm text-text-secondary" data-testid="trend-note">
              {trendNote}
            </p>
          ) : null}
          <BodyStatsFields draft={draft} errors={errors} onChange={setDraft} />
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="submit" className={primaryButton}>
              Calculate
            </button>
            <button type="button" onClick={onReset} className={secondaryButton}>
              Reset
            </button>
          </div>
        </form>
      </Section>

      <div className="flex flex-col gap-4 lg:gap-6">
        {!r || !chosen ? (
          <Section title="Result">
            <p className="text-text-secondary" data-testid="calculator-empty">
              Fill in all fields to see your TDEE.
            </p>
          </Section>
        ) : stage === 'adjust' ? (
          <Section title="Adjust targets">
            <TargetsEditor
              initial={{
                kcal: r.target_kcal,
                protein_g: r.protein_g,
                fat_g: r.fat_g,
                carbs_g: r.carbs_g,
              }}
              formula={chosen}
              initialIsFormula
              basis={chosen}
              onSaved={done}
              onCancel={() => setStage('result')}
            />
          </Section>
        ) : (
          <>
            <Section title="Result">
              <div className="-mt-4">
                <PlanChoice
                  result={r}
                  plan={r.plan}
                  deficit={deficit}
                  units={units}
                  onPlan={setPlan}
                  onDeficit={setDeficit}
                />
              </div>
              <ResultCard result={r} />
              <EstimateNotes />
              {stage === 'confirm' ? (
                <div className="mt-4">
                  <ConfirmTargets
                    current={current}
                    next={{
                      kcal: r.target_kcal,
                      protein_g: r.protein_g,
                      fat_g: r.fat_g,
                      carbs_g: r.carbs_g,
                    }}
                    saving={apply.isPending}
                    onConfirm={() => apply.mutate(chosen)}
                    onCancel={() => setStage('result')}
                  />
                </div>
              ) : (
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setStage('confirm')}
                    className={primaryButton}
                  >
                    Use these targets
                  </button>
                  <button
                    type="button"
                    onClick={() => setStage('adjust')}
                    className={secondaryButton}
                  >
                    Adjust
                  </button>
                </div>
              )}
              {applyError ? <Notice kind="error">{applyError}</Notice> : null}
            </Section>
            <Section title="Activity levels">
              <TdeeTable input={chosen} selected={chosen.activity} />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
