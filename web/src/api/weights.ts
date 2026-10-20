import { deleteJson, getJson, patchJson, postJson } from './client';

export interface WeightEntry {
  id: string;
  measured_at: string;
  /** The user's local date, YYYY-MM-DD. */
  day: string;
  kg: number;
  note: string | null;
}

export interface WeightInput {
  kg: number;
  measured_at?: string;
  note?: string | null;
}

export const WEIGHTS_KEY = ['weights'] as const;

export function listWeights() {
  return getJson<WeightEntry[]>('/weights');
}

export function addWeight(body: WeightInput) {
  return postJson<WeightEntry>('/weights', body);
}

export function editWeight(id: string, body: Partial<WeightInput>) {
  return patchJson<WeightEntry>(`/weights/${id}`, body);
}

export function deleteWeight(id: string) {
  return deleteJson<null>(`/weights/${id}`);
}

export function restoreWeight(id: string) {
  return postJson<WeightEntry>(`/weights/${id}/restore`);
}
