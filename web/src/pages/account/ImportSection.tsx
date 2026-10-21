import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { importExport } from '../../api/export';
import { importSummary } from '../../lib/importSummary';
import { Notice, secondaryButton, Section } from './Section';

/** Restore or move an account from a JSON export (SPEC page 1, Import from JSON export). */
export function ImportSection() {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [name, setName] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: importExport,
    // Everything on screen may have changed; refresh in the background.
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });

  return (
    <Section
      title="Import from a TRIM file"
      description="Bring in a JSON file from Download my data, to restore your data or move it here. This works in a new account with nothing logged yet."
    >
      <label htmlFor={id} className="sr-only">
        TRIM JSON file
      </label>
      <input
        ref={input}
        id={id}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setName(file.name);
          run.mutate(file);
        }}
      />
      <button
        type="button"
        className={`${secondaryButton} cursor-pointer`}
        disabled={run.isPending}
        onClick={() => input.current?.click()}
      >
        {run.isPending ? `Importing ${name ?? ''}`.trim() : 'Choose a JSON file'}
      </button>
      {run.isError ? (
        <Notice kind="error">
          {(run.error instanceof ApiError && run.error.userMessage) ||
            'Could not import this file. Try again.'}
        </Notice>
      ) : null}
      {run.isSuccess ? <Notice kind="ok">{importSummary(run.data.imported)}</Notice> : null}
    </Section>
  );
}
