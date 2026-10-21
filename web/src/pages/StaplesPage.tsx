import { Link } from 'react-router';
import { usePageTitle } from '../usePageTitle';
import { StaplesManager } from './staples/StaplesManager';

/** My staples, reached from Account (also the Staples tab on Log food). */
export function StaplesPage() {
  usePageTitle('My staples');
  return (
    <section className="max-w-2xl">
      <Link to="/account" className="tap text-sm font-semibold text-accent underline">
        Account
      </Link>
      <h2 className="mt-2 text-2xl font-bold">My staples</h2>
      <div className="mt-4 rounded-xl border border-border bg-surface p-4">
        <StaplesManager />
      </div>
    </section>
  );
}
