import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listSessions, revokeOtherSessions, revokeSession, SESSIONS_KEY } from '../../api/account';
import { describeDevice } from '../../lib/device';
import { Notice, secondaryButton, Section } from './Section';

function lastActive(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function DevicesSection() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: listSessions });
  const refresh = () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
  const revokeOne = useMutation({ mutationFn: revokeSession, onSuccess: refresh });
  const revokeOthers = useMutation({ mutationFn: revokeOtherSessions, onSuccess: refresh });

  const list = sessions.data ?? [];
  const others = list.filter((s) => !s.current).length;

  return (
    <Section title="Devices" description="Where you are signed in." testId="devices">
      {sessions.isPending ? <p className="text-text-secondary">Loading</p> : null}
      {sessions.isError ? (
        <Notice kind="error">Could not load your devices. Try again later.</Notice>
      ) : null}
      <ul className="flex flex-col divide-y divide-border">
        {list.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-semibold">
                {describeDevice(s.user_agent)}
                {s.current ? (
                  <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                    This device
                  </span>
                ) : null}
              </p>
              <p className="text-sm text-text-secondary">
                Last active {lastActive(s.last_seen_at)}
              </p>
            </div>
            {s.current ? null : (
              <button
                type="button"
                onClick={() => revokeOne.mutate(s.id)}
                disabled={revokeOne.isPending}
                className={`${secondaryButton} shrink-0 text-sm`}
                aria-label={`Sign out ${describeDevice(s.user_agent)}`}
              >
                Sign out
              </button>
            )}
          </li>
        ))}
      </ul>
      {others > 0 ? (
        <button
          type="button"
          onClick={() => revokeOthers.mutate()}
          disabled={revokeOthers.isPending}
          className={`${secondaryButton} mt-3`}
        >
          Sign out everywhere else
        </button>
      ) : null}
    </Section>
  );
}
