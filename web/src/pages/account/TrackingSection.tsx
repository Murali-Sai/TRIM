import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { getSettings, saveSettings, SETTINGS_KEY, type TrackingSettings } from '../../api/tracking';
import { Switch } from '../../components/Switch';
import { ReminderControls } from './ReminderControls';
import { Notice, Section } from './Section';

/** What the user tracks: water (off until turned on), fiber (on), and the water unit. */
export function TrackingSection() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: getSettings });
  const save = useMutation({
    mutationFn: saveSettings,
    onMutate: (change) => {
      const before = queryClient.getQueryData<TrackingSettings>(SETTINGS_KEY);
      if (before) queryClient.setQueryData(SETTINGS_KEY, { ...before, ...change });
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) queryClient.setQueryData(SETTINGS_KEY, ctx.before);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });
  const s = settings.data;

  return (
    <Section title="Tracking" description="Choose what Today and your charts show.">
      {s ? (
        <div className="divide-y divide-border">
          <Switch
            label="Track water"
            hint="A water row on Today with one-tap adds. Set a water target in Targets."
            checked={s.track_water}
            onChange={(on) => save.mutate({ track_water: on })}
          />
          {s.track_water ? (
            <div className="py-2">
              <label htmlFor="water-unit" className="block font-semibold">
                Water unit
              </label>
              <select
                id="water-unit"
                className="tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 sm:w-64"
                value={s.water_unit}
                onChange={(e) =>
                  save.mutate({ water_unit: e.target.value as TrackingSettings['water_unit'] })
                }
              >
                <option value="ml">Milliliters (ml)</option>
                <option value="fl_oz">Fluid ounces (fl oz)</option>
              </select>
            </div>
          ) : null}
          <Switch
            label="Streaks and badges"
            hint="A flame for days you log, weekly goals and badges. Off hides them everywhere; your history is kept."
            checked={s.gamification}
            onChange={(on) => save.mutate({ gamification: on })}
          />
          {s.gamification ? (
            <>
              <div className="py-2">
                <Link
                  to="/account/badges"
                  className="tap text-sm font-semibold text-accent underline"
                >
                  See your badges
                </Link>
              </div>
              <ReminderControls settings={s} onSave={(change) => save.mutate(change)} />
            </>
          ) : null}
          <Switch
            label="Track fiber"
            hint="Fiber against a target of 14 g per 1,000 kcal, unless you set your own."
            checked={s.track_fiber}
            onChange={(on) => save.mutate({ track_fiber: on })}
          />
        </div>
      ) : (
        <div className="min-h-24" aria-busy="true" />
      )}
      {save.isError ? (
        <Notice kind="error">Could not save. Check your connection and try again.</Notice>
      ) : null}
    </Section>
  );
}
