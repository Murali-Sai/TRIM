import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { UnitSystem } from '../../api/auth';
import { ApiError } from '../../api/client';
import { saveBodyStats, type BodyStats } from '../../api/setup';
import { Field } from '../../components/Field';
import {
  ACTIVITY_LEVELS,
  ftInToCm,
  validateBodyStats,
  type ActivityLevel,
  type BodyStatsField,
  type Sex,
} from '../../lib/tdee';
import { cmToFtIn, formatNumber, kgToLb, lbToKg, parseDecimal } from '../../lib/units';

export interface BodyStatsValues {
  sex: Sex;
  age: number;
  weight_kg: number;
  height_cm: number;
  activity: ActivityLevel;
  unit_system: UnitSystem;
}

interface Props {
  initial: BodyStats;
  onSaved: (values: BodyStatsValues) => void;
}

type Errors = Partial<Record<BodyStatsField | 'sex' | 'activity', string>>;

function initialWeight(kg: number | null, units: UnitSystem): string {
  if (kg === null) return '';
  return units === 'imperial' ? formatNumber(kgToLb(kg), 1) : String(kg);
}

export function BodyStatsStep({ initial, onSaved }: Props) {
  const [units, setUnits] = useState<UnitSystem>(initial.unit_system);
  const [age, setAge] = useState(initial.age?.toString() ?? '');
  const [sex, setSex] = useState<Sex | ''>(initial.sex ?? '');
  const [weight, setWeight] = useState(initialWeight(initial.latest_weight_kg, units));
  const startFtIn = initial.height_cm ? cmToFtIn(initial.height_cm) : null;
  const [heightCm, setHeightCm] = useState(initial.height_cm?.toString() ?? '');
  const [feet, setFeet] = useState(startFtIn?.ft.toString() ?? '');
  const [inches, setInches] = useState(startFtIn?.in.toString() ?? '');
  const [activity, setActivity] = useState<ActivityLevel | ''>(initial.activity_level ?? '');
  const [errors, setErrors] = useState<Errors>({});

  const save = useMutation({ mutationFn: saveBodyStats });

  function switchUnits(next: UnitSystem) {
    if (next === units) return;
    // Carry what was typed across, so switching never loses an entry.
    const w = parseDecimal(weight);
    if (!Number.isNaN(w)) {
      setWeight(next === 'imperial' ? formatNumber(kgToLb(w), 1) : formatNumber(lbToKg(w), 1));
    }
    if (next === 'imperial') {
      const cm = parseDecimal(heightCm);
      if (!Number.isNaN(cm)) {
        const fi = cmToFtIn(cm);
        setFeet(String(fi.ft));
        setInches(String(fi.in));
      }
    } else {
      const ft = parseDecimal(feet);
      if (!Number.isNaN(ft)) {
        setHeightCm(formatNumber(ftInToCm(ft, parseDecimal(inches) || 0), 1));
      }
    }
    setUnits(next);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const w = parseDecimal(weight);
    const weightKg = units === 'imperial' ? lbToKg(w) : w;
    const heightValue =
      units === 'imperial'
        ? ftInToCm(parseDecimal(feet), inches.trim() === '' ? 0 : parseDecimal(inches))
        : parseDecimal(heightCm);
    const ageValue = parseDecimal(age);

    const found: Errors = validateBodyStats({
      age: ageValue,
      weight_kg: weightKg,
      height_cm: heightValue,
    });
    if (!sex) found.sex = 'Choose one.';
    if (!activity) found.activity = 'Choose your activity level.';
    setErrors(found);
    if (Object.keys(found).length > 0 || !sex || !activity) return;

    const values: BodyStatsValues = {
      sex,
      age: ageValue,
      weight_kg: weightKg,
      height_cm: heightValue,
      activity,
      unit_system: units,
    };
    save.mutate(
      {
        sex,
        age: ageValue,
        height_cm: heightValue,
        activity_level: activity,
        unit_system: units,
        weight_kg: weightKg,
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
            aria-checked={units === u}
            onClick={() => switchUnits(u)}
            className={`tap rounded-md px-3 py-2 font-semibold ${
              units === u ? 'bg-surface text-text shadow-sm' : 'text-text-secondary'
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
          value={age}
          onChange={(e) => setAge(e.target.value)}
          error={errors.age}
        />
        <div>
          <label htmlFor="sex" className="block font-semibold">
            Sex for calorie formula
          </label>
          <select
            id="sex"
            value={sex}
            onChange={(e) => setSex(e.target.value as Sex)}
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
          label={units === 'imperial' ? 'Weight (lb)' : 'Weight (kg)'}
          inputMode="decimal"
          autoComplete="off"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          error={errors.weight_kg}
        />
        {units === 'imperial' ? (
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
                  value={feet}
                  onChange={(e) => setFeet(e.target.value)}
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
                  value={inches}
                  onChange={(e) => setInches(e.target.value)}
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
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            error={errors.height_cm}
          />
        )}

        <div className="min-[400px]:col-span-2">
          <label htmlFor="activity" className="block font-semibold">
            Activity level
          </label>
          <select
            id="activity"
            value={activity}
            onChange={(e) => setActivity(e.target.value as ActivityLevel)}
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
