import { usePageTitle } from '../usePageTitle';

interface PlaceholderProps {
  title: string;
  note: string;
}

// Stand-in for screens that later tasks build.
export function Placeholder({ title, note }: PlaceholderProps) {
  usePageTitle(title);
  return (
    <section>
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="mt-2 text-text-secondary">{note}</p>
    </section>
  );
}
