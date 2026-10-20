import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useMe } from '../api/auth';
import { listTargets, TARGETS_KEY, type TargetRow } from '../api/setup';
import { formatNumber } from '../lib/units';
import { usePageTitle } from '../usePageTitle';
import { Notice, Section } from './account/Section';
import { formatLongDate } from './body/weightFormat';
import { TARGETS_SAVED } from './CalculatorPage';
import { TargetsEditor } from './targets/TargetsEditor';

function CurrentTargets({ t }: { t: TargetRow }) {
  const macros = [
    { name: 'Protein', grams: t.protein_g },
    { name: 'Fat', grams: t.fat_g },
    { name: 'Carbs', grams: t.carbs_g },
  ];
  return (
    <div data-testid="current-targets">
      <p>
        <span className="text-4xl font-bold" data-testid="current-kcal">
          {formatNumber(t.kcal)}
        </span>{' '}
        kcal a day
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
        {macros.map((m) => (
          <li key={m.name}>
            <span className="font-semibold">{formatNumber(m.grams)} g</span>{' '}
            <span className="text-text-secondary">{m.name}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-text-secondary" data-testid="current-source">
        {t.source === 'custom' ? 'Your own numbers' : 'From the calculator'}, since{' '}
        {formatLongDate(t.effective_from)}.
        {t.tdee !== null ? ` Estimated maintenance ${formatNumber(t.tdee)} kcal.` : ''}
      </p>
    </div>
  );
}

/** The Targets screen: what is in effect now, the editor, and the way to the calculator. */
export function TargetsPage() {
  usePageTitle('Targets');
  const me = useMe();
  const location = useLocation();
  const queryClient = useQueryClient();
  const targets = useQuery({ queryKey: TARGETS_KEY, queryFn: listTargets });
  const fromCalculator = (location.state as Record<string, unknown> | null)?.[TARGETS_SAVED];
  const [saved, setSaved] = useState(fromCalculator === true);
  // A new key remounts the editor with the saved values after each save.
  const [version, setVersion] = useState(0);

  if (!me.data) return null;
  const current = targets.data?.[0] ?? null;

  return (
    <section>
      <h2 className="text-2xl font-bold">Targets</h2>
      {/* Phone: current, editor, calculator. Desktop: current and calculator beside the editor. */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
        <div className="lg:col-start-1 lg:row-start-1">
          <Section title="In effect now">
            {targets.isError ? (
              <Notice kind="error">Could not load your targets. Try again in a moment.</Notice>
            ) : targets.isPending ? (
              <div className="min-h-20" aria-busy="true" />
            ) : current ? (
              <CurrentTargets t={current} />
            ) : (
              <p className="text-text-secondary">
                No targets yet. Use the calculator to get starting targets.
              </p>
            )}
            {saved ? <Notice kind="ok">Targets saved.</Notice> : null}
          </Section>
        </div>
        {current ? (
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <Section
              title="Edit targets"
              description="Change calories or any macro. Carbs fill the rest of your calories unless you change them too."
            >
              <TargetsEditor
                key={version}
                initial={current}
                formula={current.formula}
                initialIsFormula={current.source === 'calculator'}
                onSaved={async () => {
                  await queryClient.invalidateQueries({ queryKey: TARGETS_KEY });
                  setVersion((v) => v + 1);
                  setSaved(true);
                }}
              />
            </Section>
          </div>
        ) : null}
        <div className="lg:col-start-1 lg:row-start-2">
          <Section
            title="TDEE calculator"
            description="Recalculate from your details and your latest trend weight. Your targets change only if you choose to use the new numbers."
          >
            <Link
              to="/targets/calculator"
              className="tap inline-block rounded-lg border border-border bg-surface px-4 py-2.5 font-semibold"
            >
              Open the calculator
            </Link>
          </Section>
        </div>
      </div>
    </section>
  );
}
