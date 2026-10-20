import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  copyLogs,
  deleteLog,
  editLog,
  LOGS_KEY,
  moveLogs,
  restoreLog,
  type LogEntry,
  type LogPatch,
} from '../../api/logs';
import type { ToastMessage } from '../../components/Toast';

function message(e: unknown): string {
  return (
    (e instanceof ApiError && e.userMessage) ||
    'Could not save. Check your connection and try again.'
  );
}

const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

/** Edit, delete (with undo), move and copy, each refreshing every day it touches. */
export function useLogActions() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: LOGS_KEY });
  const say = (text: string, action?: ToastMessage['action']) =>
    setToast({ id: Date.now(), text, ...(action ? { action } : {}) });
  const onError = (e: unknown) => setError(message(e));

  const restore = useMutation({
    mutationFn: (id: string) => restoreLog(id),
    onSuccess: refresh,
    onError: (e) => say(message(e)),
  });
  const edit = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LogPatch }) => editLog(id, patch),
    onSuccess: async () => {
      setError(null);
      await refresh();
      say('Saved.');
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (e: LogEntry) => deleteLog(e.id),
    onSuccess: async (_, e) => {
      setError(null);
      await refresh();
      say(`Deleted ${e.name}.`, { label: 'Undo', onClick: () => restore.mutate(e.id) });
    },
    onError,
  });
  const move = useMutation({
    mutationFn: ({ ids, at }: { ids: string[]; at: string }) => moveLogs(ids, at),
    onSuccess: async (rows) => {
      setError(null);
      await refresh();
      say(`Moved ${items(rows.length)}.`);
    },
    onError,
  });
  const copy = useMutation({
    mutationFn: ({ ids, at }: { ids: string[]; at: string }) => copyLogs(ids, at),
    onSuccess: async (rows) => {
      setError(null);
      await refresh();
      say(`Copied ${items(rows.length)}.`);
    },
    onError,
  });

  const busy = edit.isPending || remove.isPending || move.isPending || copy.isPending;
  const clearToast = useCallback(() => setToast(null), []);
  return { edit, remove, move, copy, busy, toast, clearToast, say, error, setError };
}
