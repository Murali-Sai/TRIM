import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from './api/health';

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth });

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-2xl font-bold">TRIM</h1>
      <p className="text-sm">
        API: {health.isPending ? 'checking' : health.isError ? 'unreachable' : health.data.status}
      </p>
    </main>
  );
}
