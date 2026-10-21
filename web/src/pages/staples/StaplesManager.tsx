import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { ApiError } from '../../api/client';
import {
  answerStaplePrompt,
  editStaple,
  getStaplePrompt,
  getStaples,
  removeStaple,
  reorderStaples,
  STAPLES_KEY,
  STAPLES_PROMPT_KEY,
  type Staple,
  type StaplePatch,
  type Staples,
} from '../../api/staples';
import { ArrowDownIcon, ArrowUpIcon, GripIcon, MealIcon } from '../../components/icons';
import { moveItem, stapleAmountLine } from '../../lib/staples';
import { formatNumber } from '../../lib/units';
import { Notice, primaryButton, secondaryButton } from '../account/Section';
import { StapleSheet } from './StapleSheet';

const message = (e: unknown, fallback: string) =>
  (e instanceof ApiError && e.userMessage) || fallback;

const iconButton =
  'tap flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors duration-200 hover:bg-surface-2 disabled:cursor-default disabled:opacity-30';

/** "Add your 10 most-logged foods as staples?", offered once after 14 days of logging. */
function StaplePromptCard() {
  const queryClient = useQueryClient();
  const prompt = useQuery({ queryKey: STAPLES_PROMPT_KEY, queryFn: getStaplePrompt });
  const answer = useMutation({
    mutationFn: answerStaplePrompt,
    onSuccess: (data) => {
      queryClient.setQueryData(STAPLES_KEY, data);
      queryClient.setQueryData(STAPLES_PROMPT_KEY, { offer: false, foods: [] });
    },
  });
  const foods = prompt.data?.foods ?? [];
  if (!prompt.data?.offer || foods.length === 0) return null;
  const n = foods.length;
  return (
    <div
      className="mt-3 rounded-xl border border-accent bg-surface-2 p-4"
      data-testid="staples-prompt"
      role="region"
      aria-label="Suggested staples"
    >
      <p className="font-semibold">
        {n === 10
          ? 'Add your 10 most-logged foods as staples?'
          : `Add your ${n} most-logged ${n === 1 ? 'food' : 'foods'} as staples?`}
      </p>
      <p className="mt-1 line-clamp-3 text-sm text-text-secondary">
        {foods.map((f) => f.name).join(', ')}
      </p>
      {answer.isError ? (
        <Notice kind="error">{message(answer.error, 'Could not save. Try again.')}</Notice>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => answer.mutate(true)}
          disabled={answer.isPending}
          className={`${primaryButton} cursor-pointer`}
        >
          Add them
        </button>
        <button
          type="button"
          onClick={() => answer.mutate(false)}
          disabled={answer.isPending}
          className={`${secondaryButton} cursor-pointer`}
        >
          No thanks
        </button>
      </div>
    </div>
  );
}

function StapleRow({
  staple,
  index,
  last,
  busy,
  dragging,
  onMove,
  onToggle,
  onEdit,
  dragProps,
}: {
  staple: Staple;
  index: number;
  last: number;
  busy: boolean;
  dragging: boolean;
  onMove: (to: number) => void;
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  dragProps: {
    draggable: boolean;
    onDragStart: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onDragEnd: () => void;
  };
}) {
  const name = staple.name ?? 'Deleted food';
  const kcal = formatNumber(Math.round(staple.per_unit.kcal));
  return (
    <li
      className={`flex items-center gap-1 py-1 ${dragging ? 'opacity-50' : ''}`}
      data-testid="staple-row"
      {...dragProps}
    >
      <span
        className="hidden h-11 w-6 shrink-0 cursor-grab items-center justify-center text-text-secondary lg:flex"
        aria-hidden="true"
        title="Drag to reorder"
      >
        <GripIcon width={18} height={18} />
      </span>
      <button
        type="button"
        onClick={onEdit}
        className="tap flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-200 hover:bg-surface-2"
        aria-label={`Edit ${name}`}
      >
        {staple.saved_meal_id ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-secondary">
            <MealIcon width={18} height={18} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span
            className={`line-clamp-2 font-semibold ${
              staple.missing ? 'text-text-secondary line-through' : ''
            } ${staple.is_available ? '' : 'text-text-secondary'}`}
          >
            {name}
          </span>
          <span className="num block text-sm text-text-secondary">
            {staple.missing
              ? 'No longer exists, so it is never suggested'
              : `${stapleAmountLine(staple)} · ${kcal} kcal each`}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onMove(index - 1)}
        disabled={busy || index === 0}
        className={iconButton}
        aria-label={`Move ${name} up`}
      >
        <ArrowUpIcon width={18} height={18} />
      </button>
      <button
        type="button"
        onClick={() => onMove(index + 1)}
        disabled={busy || index === last}
        className={iconButton}
        aria-label={`Move ${name} down`}
      >
        <ArrowDownIcon width={18} height={18} />
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={staple.is_available}
        aria-label={`Use ${name} in suggestions`}
        disabled={busy || staple.missing}
        onClick={() => onToggle(!staple.is_available)}
        className="tap flex h-11 shrink-0 cursor-pointer items-center pl-1 disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={`relative h-7 w-12 rounded-full transition-colors duration-200 ${
            staple.is_available && !staple.missing ? 'bg-accent' : 'bg-border'
          }`}
        >
          <span
            className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-surface shadow transition-transform duration-200 motion-reduce:transition-none ${
              staple.is_available && !staple.missing ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </span>
      </button>
    </li>
  );
}

/**
 * My staples (SPEC page 4): up to 20 rows with a "14 of 20" counter, an availability switch,
 * up and down buttons (and drag on desktop) to reorder, and an edit sheet for the unit and
 * amounts. Shown on the Log food Staples tab and on /staples.
 */
export function StaplesManager() {
  const queryClient = useQueryClient();
  const staples = useQuery({ queryKey: STAPLES_KEY, queryFn: getStaples });
  const [editing, setEditing] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const saved = (data: Staples | null) => {
    if (data) queryClient.setQueryData(STAPLES_KEY, data);
    return queryClient.invalidateQueries({ queryKey: STAPLES_KEY });
  };
  const edit = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: StaplePatch }) => editStaple(id, patch),
    onSuccess: async (data) => {
      setEditing(null);
      await saved(data);
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => editStaple(id, { is_available: on }),
    onMutate: ({ id, on }) => {
      queryClient.setQueryData<Staples>(STAPLES_KEY, (old) =>
        old
          ? {
              ...old,
              staples: old.staples.map((s) => (s.id === id ? { ...s, is_available: on } : s)),
            }
          : old,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: STAPLES_KEY }),
  });
  const remove = useMutation({
    mutationFn: removeStaple,
    onSuccess: async () => {
      setEditing(null);
      await saved(null);
      await queryClient.invalidateQueries({ queryKey: STAPLES_PROMPT_KEY });
    },
  });
  const reorder = useMutation({
    mutationFn: reorderStaples,
    onMutate: (ids) => {
      queryClient.setQueryData<Staples>(STAPLES_KEY, (old) =>
        old
          ? {
              ...old,
              staples: ids
                .map((id) => old.staples.find((s) => s.id === id))
                .filter((s): s is Staple => s !== undefined),
            }
          : old,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: STAPLES_KEY }),
  });

  const list = staples.data?.staples ?? [];
  const current = list.find((s) => s.id === editing) ?? null;
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return;
    reorder.mutate(moveItem(list, from, to).map((s) => s.id));
  };
  const failed = toggle.error ?? reorder.error ?? remove.error;

  return (
    <div data-testid="staples-manager">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-text-secondary">
          Foods and meals you eat often. Suggestions combine the ones that are on.
        </p>
        {staples.data ? (
          <p
            className="num shrink-0 text-sm font-semibold"
            data-testid="staples-count"
            aria-label={`${staples.data.count} of ${staples.data.limit} staples`}
          >
            {staples.data.count} of {staples.data.limit}
          </p>
        ) : null}
      </div>
      <StaplePromptCard />
      {staples.isError ? (
        <Notice kind="error">Could not load your staples. Try again in a moment.</Notice>
      ) : null}
      {failed ? (
        <Notice kind="error">{message(failed, 'Could not save. Try again.')}</Notice>
      ) : null}
      {staples.data && list.length === 0 ? (
        <p className="mt-3 text-sm text-text-secondary" data-testid="staples-empty">
          No staples yet. Open a food or a saved meal and choose Add as staple.
        </p>
      ) : null}
      {list.length > 0 ? (
        <ul className="mt-2 flex flex-col divide-y divide-border" aria-label="Your staples">
          {list.map((s, i) => (
            <StapleRow
              key={s.id}
              staple={s}
              index={i}
              last={list.length - 1}
              busy={reorder.isPending}
              dragging={dragFrom === i}
              onMove={(to) => move(i, to)}
              onToggle={(on) => toggle.mutate({ id: s.id, on })}
              onEdit={() => {
                edit.reset();
                setEditing(s.id);
              }}
              dragProps={{
                draggable: true,
                onDragStart: (e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  setDragFrom(i);
                },
                onDragOver: (e) => {
                  if (dragFrom !== null) e.preventDefault();
                },
                onDrop: (e) => {
                  e.preventDefault();
                  if (dragFrom !== null) move(dragFrom, i);
                  setDragFrom(null);
                },
                onDragEnd: () => setDragFrom(null),
              }}
            />
          ))}
        </ul>
      ) : null}
      {current ? (
        <StapleSheet
          key={current.id}
          staple={current}
          busy={edit.isPending || remove.isPending}
          error={
            edit.error
              ? message(edit.error, 'Could not save. Try again.')
              : remove.error
                ? message(remove.error, 'Could not remove. Try again.')
                : null
          }
          onClose={() => setEditing(null)}
          onSave={(patch) => edit.mutate({ id: current.id, patch })}
          onRemove={() => remove.mutate(current.id)}
        />
      ) : null}
    </div>
  );
}
