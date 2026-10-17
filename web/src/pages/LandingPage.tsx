import { Link } from 'react-router';
import { AuthLayout } from '../components/AuthLayout';
import { usePageTitle } from '../usePageTitle';

export function LandingPage() {
  usePageTitle(null);
  return (
    <AuthLayout>
      <p className="text-center text-lg">
        Log food, weight and body measurements in seconds, on your phone or laptop.
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <Link
          to="/signup"
          className="tap rounded-lg bg-accent px-4 py-3 text-center font-semibold text-accent-contrast"
        >
          Sign up
        </Link>
        <Link
          to="/login"
          className="tap rounded-lg border border-border px-4 py-3 text-center font-semibold"
        >
          Log in
        </Link>
      </div>
    </AuthLayout>
  );
}
