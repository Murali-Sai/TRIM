import { Link } from 'react-router';
import { usePageTitle } from '../../usePageTitle';

const CHARTS = [
  { to: '/charts/calories', title: 'Calories', text: 'Daily calories against your target.' },
  {
    to: '/charts/macros',
    title: 'Macros',
    text: 'Protein, fat and carbs, and your calorie split.',
  },
  { to: '/body', title: 'Weight', text: 'Your weigh-ins and trend.' },
];

/** Until the Progress dashboard (task 3.10): links to the full charts. */
export function ChartsIndex() {
  usePageTitle('Charts');
  return (
    <section>
      <h2 className="text-2xl font-bold">Charts</h2>
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CHARTS.map((c) => (
          <li key={c.to}>
            <Link
              to={c.to}
              className="tap block h-full rounded-xl border border-border bg-surface p-4 transition-colors duration-200 hover:bg-surface-2"
            >
              <span className="block font-semibold">{c.title}</span>
              <span className="mt-1 block text-sm text-text-secondary">{c.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
