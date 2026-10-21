import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ME_KEY, useMe } from '../../api/auth';
import { BODY_STATS_KEY, getBodyStats, type BodyStats } from '../../api/setup';
import { AuthLayout } from '../../components/AuthLayout';
import { usePageTitle } from '../../usePageTitle';
import { BodyStatsStep, type BodyStatsValues } from './BodyStatsStep';
import { PresetsStep } from './PresetsStep';
import { TargetsStep } from './TargetsStep';

function toValues(s: BodyStats): BodyStatsValues | null {
  if (!s.sex || s.age === null || s.height_cm === null || !s.activity_level) return null;
  if (s.latest_weight_kg === null) return null;
  return {
    sex: s.sex,
    age: s.age,
    weight_kg: s.latest_weight_kg,
    height_cm: s.height_cm,
    activity: s.activity_level,
    unit_system: s.unit_system,
  };
}

/** Sign-up steps 2 to 4, after the account exists: body stats, targets, then measurements. */
export function SetupPage() {
  usePageTitle('Set up');
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [entered, setEntered] = useState<BodyStatsValues | null>(null);
  const [editing, setEditing] = useState(false);
  // Step 4 comes after the targets are saved, so setup already reads as done by then.
  const [presets, setPresets] = useState(false);
  const finished = me.data?.setup === 'done' && !entered && !presets;
  const stats = useQuery({
    queryKey: BODY_STATS_KEY,
    queryFn: getBodyStats,
    enabled: !!me.data && !finished,
  });

  if (me.isPending) return <div className="min-h-dvh" aria-busy="true" />;
  if (!me.data) return <Navigate to="/welcome" replace />;
  if (finished) return <Navigate to="/" replace />;
  if (stats.isPending) return <div className="min-h-dvh" aria-busy="true" />;

  const saved = stats.data ? toValues(stats.data) : null;
  const values = entered ?? saved;
  const showStats = editing || !values || me.data.setup === 'body_stats';

  if (presets) {
    return (
      <AuthLayout wide>
        <PresetsStep onDone={() => navigate('/', { replace: true })} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout wide>
      {showStats || !values ? (
        <BodyStatsStep
          initial={
            stats.data ?? {
              sex: null,
              age: null,
              height_cm: null,
              activity_level: null,
              unit_system: me.data.unit_system,
              latest_weight_kg: null,
              goal_weight_kg: null,
            }
          }
          onSaved={async (v) => {
            setEntered(v);
            setEditing(false);
            await queryClient.invalidateQueries({ queryKey: ME_KEY });
          }}
        />
      ) : (
        <TargetsStep
          stats={values}
          onEditStats={() => setEditing(true)}
          onApplied={async () => {
            setPresets(true);
            await queryClient.invalidateQueries({ queryKey: ME_KEY });
          }}
        />
      )}
    </AuthLayout>
  );
}
