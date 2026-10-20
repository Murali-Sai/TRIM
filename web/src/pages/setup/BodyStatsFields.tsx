import { Field } from '../../components/Field';
import { ACTIVITY_LEVELS, type ActivityLevel, type Sex } from '../../lib/tdee';
import { switchUnits, type BodyStatsDraft, type BodyStatsErrors } from './bodyStatsDraft';

interface Props {
  draft: BodyStatsDraft;
  errors: BodyStatsErrors;
  onChange: (next: BodyStatsDraft) => void;
}

/** The unit toggle and the body stats fields, shared by sign-up and the TDEE calculator. */
export function BodyStatsFields({ draft: d, errors, onChange }: Props) {
  const set = (patch: Partial<BodyStatsDraft>) => onChange({ ...d, ...patch });
  return (
    <>
      <div
        role="radiogroup"
        aria-label="Units"
        className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1"
      >
        {(['imperial', 'metric'] as const).map((u) => (
          <button
            key={u}
            type="button"
            role="radio"
            aria-checked={d.units === u}
            onClick={() => onChange(switchUnits(d, u))}
            className={`tap rounded-md px-3 py-2 font-semibold ${
              d.units === u ? 'bg-surface text-text shadow-sm' : 'text-text-secondary'
            }`}
          >
            {u === 'imperial' ? 'Imperial' : 'Metric'}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 min-[400px]:grid-cols-2">
        <Field
          id="age"
          label="Age (years)"
          inputMode="numeric"
          autoComplete="off"
          value={d.age}
          onChange={(e) => set({ age: e.target.value })}
          error={errors.age}
        />
        <div>
          <label htmlFor="sex" className="block font-semibold">
            Sex for calorie formula
          </label>
          <select
            id="sex"
            value={d.sex}
            onChange={(e) => set({ sex: e.target.value as Sex })}
            aria-invalid={errors.sex ? true : undefined}
            aria-describedby="sex-hint"
            className={`tap mt-1 w-full rounded-lg border bg-surface px-3 py-2.5 ${
              errors.sex ? 'border-error' : 'border-border'
            }`}
          >
            <option value="" disabled>
              Choose
            </option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
          <p id="sex-hint" className="mt-1 text-sm text-text-secondary">
            {errors.sex ??
              'Choose the option that most closely matches your hormonal makeup. It is used only in the calorie formula.'}
          </p>
        </div>

        <Field
          id="weight"
          label={d.units === 'imperial' ? 'Weight (lb)' : 'Weight (kg)'}
          inputMode="decimal"
          autoComplete="off"
          value={d.weight}
          onChange={(e) => set({ weight: e.target.value })}
          error={errors.weight_kg}
        />
        {d.units === 'imperial' ? (
          <fieldset>
            <legend className="font-semibold">Height</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <label className="sr-only" htmlFor="height-ft">
                Feet
              </label>
              <div className="relative">
                <input
                  id="height-ft"
                  inputMode="numeric"
                  value={d.feet}
                  onChange={(e) => set({ feet: e.target.value })}
                  aria-invalid={errors.height_cm ? true : undefined}
                  className={`tap w-full rounded-lg border bg-surface py-2.5 pl-3 pr-8 ${
                    errors.height_cm ? 'border-error' : 'border-border'
                  }`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary">
                  ft
                </span>
              </div>
              <label className="sr-only" htmlFor="height-in">
                Inches
              </label>
              <div className="relative">
                <input
                  id="height-in"
                  inputMode="numeric"
                  value={d.inches}
                  onChange={(e) => set({ inches: e.target.value })}
                  aria-invalid={errors.height_cm ? true : undefined}
                  className={`tap w-full rounded-lg border bg-surface py-2.5 pl-3 pr-8 ${
                    errors.height_cm ? 'border-error' : 'border-border'
                  }`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary">
                  in
                </span>
              </div>
            </div>
            {errors.height_cm ? (
              <p className="mt-1 text-sm font-medium">{errors.height_cm}</p>
            ) : null}
          </fieldset>
        ) : (
          <Field
            id="height-cm"
            label="Height (cm)"
            inputMode="decimal"
            autoComplete="off"
            value={d.heightCm}
            onChange={(e) => set({ heightCm: e.target.value })}
            error={errors.height_cm}
          />
        )}

        <div className="min-[400px]:col-span-2">
          <label htmlFor="activity" className="block font-semibold">
            Activity level
          </label>
          <select
            id="activity"
            value={d.activity}
            onChange={(e) => set({ activity: e.target.value as ActivityLevel })}
            aria-invalid={errors.activity ? true : undefined}
            className={`tap mt-1 w-full rounded-lg border bg-surface px-3 py-2.5 ${
              errors.activity ? 'border-error' : 'border-border'
            }`}
          >
            <option value="" disabled>
              Choose your activity level
            </option>
            {ACTIVITY_LEVELS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          {errors.activity ? <p className="mt-1 text-sm font-medium">{errors.activity}</p> : null}
        </div>
      </div>
    </>
  );
}
