import { deleteJson, getJson, patchJson, postJson } from './client';

export type PhaseKind = 'cut' | 'maintain' | 'bulk' | 'custom';

export interface PhaseSummary {
  days: number;
  logged_days: number;
  avg_kcal: number | null;
  avg_target_kcal: number | null;
  days_on_target: number;
  /** Trend in kg on the phase's first and last weigh-ins; weekly_kg once they are a week apart. */
  weight: { start_kg: number; end_kg: number; change_kg: number; weekly_kg: number | null } | null;
  /** In the stored unit (cm, kg or %), from the first to the latest reading in the phase. */
  measurements: {
    type_id: string;
    name: string;
    side: 'left' | 'right' | null;
    unit: string;
    start: number;
    end: number;
    change: number;
  }[];
}

export interface Phase {
  id: string;
  kind: PhaseKind;
  label: string | null;
  /** The label, or the kind's name ("Cut"). */
  name: string;
  start_date: string;
  /** null while ongoing. */
  end_date: string | null;
  note: string | null;
  status: 'upcoming' | 'ongoing' | 'ended';
  summary: PhaseSummary | null;
}

export interface PhaseInput {
  kind: PhaseKind;
  label?: string | null;
  start_date: string;
  end_date?: string | null;
  note?: string | null;
  /** End the ongoing phase the day before this one starts. */
  end_current?: boolean;
}

export const PHASES_KEY = ['phases'] as const;

export function listPhases(summaries = true) {
  return getJson<Phase[]>(`/phases${summaries ? '' : '?summaries=false'}`);
}

export function createPhase(body: PhaseInput) {
  return postJson<Phase>('/phases', body);
}

export function editPhase(id: string, body: Partial<Omit<PhaseInput, 'end_current'>>) {
  return patchJson<Phase>(`/phases/${id}`, body);
}

export function deletePhase(id: string) {
  return deleteJson(`/phases/${id}`);
}
