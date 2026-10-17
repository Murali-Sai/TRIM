import { AuthLayout } from '../components/AuthLayout';
import { usePageTitle } from '../usePageTitle';

// Sign-up and login forms arrive in tasks 1.4 and 1.5.
export function AuthPlaceholder({ title }: { title: string }) {
  usePageTitle(title);
  return (
    <AuthLayout>
      <h2 className="text-center text-2xl font-bold">{title}</h2>
    </AuthLayout>
  );
}
