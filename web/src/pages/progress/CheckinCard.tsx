import { useQuery } from '@tanstack/react-query';
import { CHECKINS_KEY, listCheckins } from '../../api/checkins';
import { DashCard } from './DashCard';

/** "This week's check-in" (SPEC page 4): the latest check-in's first three sentences. */
export function CheckinCard() {
  const q = useQuery({ queryKey: CHECKINS_KEY, queryFn: listCheckins });
  const latest = q.data?.[0];
  if (!latest) {
    return (
      <DashCard
        title="This week's check-in"
        headline={q.isPending ? ' ' : 'Your first check-in arrives next Monday'}
        testId="card-checkin"
      >
        <p className="text-sm text-text-secondary">
          Each week, a short summary of how the week went: average calories and days on target.
        </p>
      </DashCard>
    );
  }
  return (
    <DashCard
      title="This week's check-in"
      headline={latest.headline}
      to={`/checkins/${latest.week_start}`}
      action="Read the check-in."
      testId="card-checkin"
    >
      <ul className="flex flex-col gap-1 text-sm">
        {latest.preview.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-2 text-sm font-semibold text-accent">Read more</p>
    </DashCard>
  );
}
