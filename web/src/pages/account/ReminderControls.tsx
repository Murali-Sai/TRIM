import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { deleteSubscription, getPushConfig, saveSubscription } from '../../api/push';
import type { TrackingSettings } from '../../api/tracking';
import { Switch } from '../../components/Switch';
import { PushDenied, pushSupport, subscribeBrowser, unsubscribeBrowser } from '../../lib/push';
import { Notice } from './Section';

const DEFAULT_TIME = '20:00';

/** Opt-in streak reminder: one a day at the chosen time, only if today has nothing logged. */
export function ReminderControls({
  settings,
  onSave,
}: {
  settings: TrackingSettings;
  onSave: (change: Partial<TrackingSettings>) => void;
}) {
  const id = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const support = pushSupport();
  const on = settings.streak_reminder != null;

  const turnOn = useMutation({
    mutationFn: async () => {
      const config = await getPushConfig();
      if (!config.public_key) throw new Error('Reminders are not set up on this server yet.');
      await saveSubscription(await subscribeBrowser(config.public_key));
    },
    onSuccess: () => {
      setProblem(null);
      onSave({ streak_reminder: settings.streak_reminder ?? DEFAULT_TIME });
    },
    onError: (e) =>
      setProblem(
        e instanceof PushDenied
          ? 'Notifications are blocked for TRIM. Allow them in your browser settings, then try again.'
          : e instanceof Error && e.message.startsWith('Reminders')
            ? e.message
            : 'Could not turn on reminders. Try again in a moment.',
      ),
  });
  const turnOff = useMutation({
    mutationFn: async () => {
      const endpoint = await unsubscribeBrowser().catch(() => null);
      if (endpoint) await deleteSubscription(endpoint);
    },
    onSettled: () => onSave({ streak_reminder: null }),
  });

  const hint =
    support === 'ios-home-screen'
      ? 'On iPhone, add TRIM to your Home Screen first (Share, then Add to Home Screen), then turn this on there.'
      : support === 'unsupported'
        ? 'This browser cannot show reminders.'
        : 'One reminder a day at your chosen time, only if nothing is logged yet. Never after you log.';

  return (
    <div className="py-1" data-testid="reminder-controls">
      <Switch
        label="Streak reminder"
        hint={hint}
        checked={on}
        disabled={support !== 'ok' || turnOn.isPending || turnOff.isPending}
        onChange={(next) => (next ? turnOn.mutate() : turnOff.mutate())}
      />
      {on ? (
        <div className="pb-2">
          <label htmlFor={`${id}-time`} className="block text-sm font-semibold">
            Remind me at
          </label>
          <input
            id={`${id}-time`}
            type="time"
            value={settings.streak_reminder ?? DEFAULT_TIME}
            onChange={(e) => e.target.value && onSave({ streak_reminder: e.target.value })}
            className="tap mt-1 rounded-lg border border-border bg-surface px-3 py-2"
          />
        </div>
      ) : null}
      {problem ? <Notice kind="error">{problem}</Notice> : null}
    </div>
  );
}
