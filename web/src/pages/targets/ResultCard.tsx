import { useId, useState } from 'react';
import { DEFICITS, KCAL_PER_G, type CalcResult, type Deficit, type Plan } from '../../lib/tdee';
import { formatNumber, kgToLb } from '../../lib/units';
import type { UnitSystem } from '../../api/auth';

export function InfoToggle({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="tap ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-xs font-bold text-text-secondary"
      >
        <span aria-hidden="true">i</span>
        <span className="sr-only">{label}</span>
      </button>
      {open ? (
        <p id={id} className="mt-2 text-sm text-text-secondary">
          {children}
        </p>
      ) : null}
    </>
  );
}

export function MacroBar({
  name,
  grams,
  rule,
  share,
  color,
}: {
  name: string;
  grams: number;
  rule: string;
  share: number;
  color: string;
}) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span>
          <span className="font-semibold">
            {name} {formatNumber(grams)} g
          </span>{' '}
          <span className="text-sm text-text-secondary">({rule})</span>
        </span>
        <span className="text-sm text-text-secondary">{Math.round(share * 100)}%</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-surface-2" aria-hidden="true">
        <div
          className="h-2 rounded-full"
          style={{ width: `${Math.min(100, share * 100)}%`, background: `var(--color-${color})` }}
        />
      </div>
    </li>
  );
}

function macroRules(r: CalcResult) {
  return r.rule_set === 'high_bmi'
    ? { protein: '0.7 g per lb', fat: '25% of calories' }
    : { protein: '0.8 g per lb', fat: '0.3 g per lb' };
}

interface PlanChoiceProps {
  result: CalcResult;
  plan: Plan;
  deficit: Deficit;
  units: UnitSystem;
  onPlan: (plan: Plan) => void;
  onDeficit: (deficit: Deficit) => void;
}

/** BMI, the Lose weight and Maintain cards, and the deficit chips with the rough pace. */
export function PlanChoice({
  result: r,
  plan,
  deficit,
  units,
  onPlan,
  onDeficit,
}: PlanChoiceProps) {
  const suggested = r.suggested_plan;
  const pace =
    units === 'imperial'
      ? `About ${formatNumber(kgToLb(r.pace_kg_per_week), 1)} lb a week`
      : `About ${formatNumber(r.pace_kg_per_week, 1)} kg a week`;
  return (
    <>
      <div className="mt-4 flex items-start">
        <p data-testid="bmi">BMI {formatNumber(r.bmi, 1)}</p>
        <InfoToggle label="About BMI">
          BMI compares weight with height. It is a rough guide only and can misjudge muscular
          people, so the choice below is yours.
        </InfoToggle>
      </div>

      <fieldset className="mt-4">
        <legend className="sr-only">Plan</legend>
        <div className="grid grid-cols-2 gap-3">
          {(['lose', 'maintain'] as const).map((p) => (
            <label
              key={p}
              className={`tap relative flex cursor-pointer flex-col rounded-xl border-2 p-3 ${
                plan === p ? 'border-accent' : 'border-border'
              }`}
            >
              <input
                type="radio"
                name="plan"
                value={p}
                checked={plan === p}
                onChange={() => onPlan(p)}
                className="sr-only"
              />
              <span className="font-semibold">{p === 'lose' ? 'Lose weight' : 'Maintain'}</span>
              {p === suggested ? (
                <span className="mt-1 w-fit rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">
                  Suggested
                </span>
              ) : null}
            </label>
          ))}
        </div>
      </fieldset>

      {plan === 'lose' ? (
        <div className="mt-4">
          <p id="deficit-label" className="font-semibold">
            Daily deficit
          </p>
          <div role="radiogroup" aria-labelledby="deficit-label" className="mt-2 flex gap-2">
            {DEFICITS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={deficit === d}
                onClick={() => onDeficit(d)}
                className={`tap flex-1 rounded-lg border px-2 py-2 font-semibold ${
                  deficit === d ? 'border-accent bg-surface-2' : 'border-border'
                }`}
              >
                {d} kcal
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-text-secondary" data-testid="pace">
            {pace}. Rough estimate.
          </p>
        </div>
      ) : null}
    </>
  );
}

/** The result card: maintenance calories, BMR, the daily target and the three macro bars. */
export function ResultCard({ result: r }: { result: CalcResult }) {
  const totalKcal = r.target_kcal || 1;
  const shares = {
    protein: (r.protein_g * KCAL_PER_G.protein) / totalKcal,
    fat: (r.fat_g * KCAL_PER_G.fat) / totalKcal,
    carbs: (r.carbs_g * KCAL_PER_G.carbs) / totalKcal,
  };
  const rules = macroRules(r);
  const below = r.tdee - r.target_kcal;
  return (
    <section
      className="mt-6 rounded-xl border border-border bg-surface p-4"
      aria-labelledby="result-heading"
      data-testid="result-card"
    >
      <h3 id="result-heading" className="font-semibold">
        Your maintenance calories
      </h3>
      <p className="mt-1">
        <span className="text-4xl font-bold" data-testid="tdee">
          {formatNumber(r.tdee)}
        </span>{' '}
        kcal a day
      </p>
      <p className="text-sm text-text-secondary">{formatNumber(r.weekly_tdee)} a week</p>
      <div className="mt-2 flex items-start text-sm text-text-secondary">
        <p data-testid="bmr">BMR {formatNumber(r.bmr)} kcal</p>
        <InfoToggle label="About BMR and maintenance">
          BMR is the energy your body uses at rest. Maintenance adds your daily activity, so eating
          this much keeps your weight about the same.
        </InfoToggle>
      </div>

      {r.target_kcal !== r.tdee ? (
        <p className="mt-3 font-semibold" data-testid="daily-target">
          Target {formatNumber(r.target_kcal)} kcal, {formatNumber(below)} below maintenance
        </p>
      ) : null}
      {r.floor_applied ? (
        <p className="mt-1 text-sm" data-testid="floor-note">
          {formatNumber(r.target_kcal)} kcal is the lowest suggested target, so the deficit is
          smaller than the one you chose.
        </p>
      ) : null}

      <ul className="mt-4 flex flex-col gap-3" data-testid="macros">
        <MacroBar
          name="Protein"
          grams={r.protein_g}
          rule={rules.protein}
          share={shares.protein}
          color="protein"
        />
        <MacroBar name="Fat" grams={r.fat_g} rule={rules.fat} share={shares.fat} color="fat" />
        <MacroBar
          name="Carbs"
          grams={r.carbs_g}
          rule="the rest"
          share={shares.carbs}
          color="carbs"
        />
      </ul>
    </section>
  );
}

/** The two notes under every result card. */
export function EstimateNotes() {
  return (
    <>
      <p className="mt-4 text-sm text-text-secondary">
        This is an estimate from a standard formula. You can change your targets anytime.
      </p>
      <p className="mt-2 text-sm text-text-secondary">
        Not suitable during pregnancy or breastfeeding, or with a medical condition that affects
        diet. Check with a doctor first.
      </p>
    </>
  );
}
