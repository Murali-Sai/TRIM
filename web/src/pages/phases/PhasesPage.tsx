import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useMe, type UnitSystem } from '../../api/auth';
import { ApiError } from '../../api/client';
import {
  createPhase,
  deletePhase,
  editPhase,
  listPhases,
  PHASES_KEY,
  type Phase,
  type PhaseInput,
} from '../../api/phases';
import { shortDate } from '../../lib/chart/headlines';
import { phaseDates, summaryLines } from '../../lib/phases';
import { isoToZonedWall } from '../../lib/zoned';
import { usePageTitle } from '../../usePageTitle';
import { Notice, primaryButton, secondaryButton } from '../account/Section';
import { PhaseSheet } from './PhaseSheet';

type Open = { mode: 'new' } | { mode: 'edit'; phase: Phase } | null;

function statusText(p: Phase): string {
  if (p.status === 'upcoming') return `Starts ${shortDate(p.start_date)}`;
  if (p.status === 'ongoing') return `Day ${p.summary?.days ?? 1}`;
  return 'Ended';
}

function message(e: unknown): string | null {
  if (!e) return null;
  return (e instanceof ApiError && e.userMessage) || 'Could not save. Try again.';
}

/** Diet phases (SPEC page 4): a list with summaries on phones, a table on desktop. */
export function PhasesPage() {
  usePageTitle('Diet phases');
  const me = useMe();
  if (!me.data) return null;
  return <Phases timeZone={me.data.timezone} units={me.data.unit_system} />;
}

function Phases({ timeZone, units }: { timeZone: string; units: UnitSystem }) {
  const queryClient = useQueryClient();
  const today = isoToZonedWall(new Date().toISOString(), timeZone).slice(0, 10);
  const q = useQuery({ queryKey: PHASES_KEY, queryFn: () => listPhases() });
  const [open, setOpen] = useState<Open>(null);
  const [saved, setSaved] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: PHASES_KEY });
  const save = useMutation({
    mutationFn: (body: PhaseInput) =>
      open?.mode === 'edit' ? editPhase(open.phase.id, body) : createPhase(body),
    onSuccess: async () => {
      setSaved(true);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deletePhase(id),
    onSuccess: async () => {
      close();
      await refresh();
    },
  });

  function show(next: Open) {
    save.reset();
    remove.reset();
    setSaved(false);
    setOpen(next);
  }
  function close() {
    setOpen(null);
    setSaved(false);
  }

  const phases = q.data ?? [];
  const ongoing = phases.find((p) => p.end_date === null && p.status !== 'upcoming') ?? null;

  return (
    <section>
      <Link to="/charts" className="tap text-sm font-semibold text-accent underline">
        Charts
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-2xl font-bold">Diet phases</h2>
        <button
          type="button"
          className={`${primaryButton} cursor-pointer`}
          onClick={() => show({ mode: 'new' })}
        >
          New phase
        </button>
      </div>
      <p className="mt-2 max-w-prose text-text-secondary">
        Mark a cut, maintenance, bulk or any stretch of your own. Every time chart shades its dates
        so you can compare periods. Phases never change your targets.
      </p>
      {q.isError ? (
        <Notice kind="error">Could not load your phases. Try again in a moment.</Notice>
      ) : null}

      {q.isSuccess && phases.length === 0 ? (
        <div
          className="mt-4 rounded-xl border border-dashed border-border p-6 text-center"
          data-testid="phases-empty"
        >
          <p className="font-semibold">No phases yet</p>
          <p className="mt-1 text-text-secondary">
            Add one to see its dates on your charts and a summary of how it went.
          </p>
        </div>
      ) : null}

      {phases.length > 0 ? (
        <>
          {/* Phone and tablet: cards. */}
          <ul className="mt-4 flex flex-col gap-4 lg:hidden" data-testid="phase-cards">
            {phases.map((p) => (
              <li
                key={p.id}
                className="rounded-xl border border-border bg-surface p-4"
                data-testid="phase-card"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    <p className="text-sm text-text-secondary">
                      {phaseDates(p)} · {statusText(p)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`${secondaryButton} cursor-pointer text-sm`}
                    aria-label={`Edit ${p.name}`}
                    onClick={() => show({ mode: 'edit', phase: p })}
                  >
                    Edit
                  </button>
                </div>
                {p.note ? <p className="mt-2 text-sm">{p.note}</p> : null}
                {p.summary ? (
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    {summaryLines(p.summary, units).map((l) => (
                      <div key={l.label} className="contents">
                        <dt className="text-text-secondary">{l.label}</dt>
                        <dd className="num">{l.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-3 text-sm text-text-secondary">
                    The summary starts on its first day.
                  </p>
                )}
              </li>
            ))}
          </ul>

          {/* Desktop: a table. */}
          <div className="mt-4 hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-left text-sm" data-testid="phase-table">
              <caption className="sr-only">Your diet phases with their summaries</caption>
              <thead>
                <tr className="border-b border-border text-text-secondary">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Phase
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Dates
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Summary
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {phases.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-border align-top"
                    data-testid="phase-row"
                  >
                    <th scope="row" className="py-3 pr-4">
                      <span className="block text-base font-semibold">{p.name}</span>
                      {p.note ? (
                        <span className="block font-normal text-text-secondary">{p.note}</span>
                      ) : null}
                    </th>
                    <td className="py-3 pr-4">
                      <span className="block">{phaseDates(p)}</span>
                      <span className="block text-text-secondary">{statusText(p)}</span>
                    </td>
                    <td className="py-3 pr-4">
                      {p.summary ? (
                        <ul className="num flex flex-col gap-0.5">
                          {summaryLines(p.summary, units).map((l) => (
                            <li key={l.label}>
                              <span className="font-sans text-text-secondary">{l.label}: </span>
                              {l.value}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-text-secondary">
                          The summary starts on its first day.
                        </span>
                      )}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        className={`${secondaryButton} cursor-pointer text-sm`}
                        aria-label={`Edit ${p.name}`}
                        onClick={() => show({ mode: 'edit', phase: p })}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {open ? (
        <PhaseSheet
          key={open.mode === 'edit' ? open.phase.id : 'new'}
          phase={open.mode === 'edit' ? open.phase : null}
          ongoing={open.mode === 'new' ? ongoing : null}
          today={today}
          busy={save.isPending || remove.isPending}
          error={message(save.error ?? remove.error)}
          saved={saved}
          onSave={(body) => save.mutate(body)}
          onDelete={() => open.mode === 'edit' && remove.mutate(open.phase.id)}
          onClose={close}
        />
      ) : null}
    </section>
  );
}
