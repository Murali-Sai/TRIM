import { deleteJson, getJson, patchJson, postJson } from './client';
import type { UnitSystem } from './auth';
import type { ThemeChoice } from '../theme';

export interface ProfileUpdate {
  display_name?: string;
  timezone?: string;
  unit_system?: UnitSystem;
  theme?: ThemeChoice;
}

export function updateProfile(body: ProfileUpdate) {
  return patchJson<Required<ProfileUpdate>>('/me/profile', body);
}

export function changePassword(body: {
  current_password: string;
  new_password: string;
  keep_signed_in: boolean;
}) {
  return postJson<{ status: 'password_changed' }>('/me/password', body);
}

export interface DeviceSession {
  id: string;
  created_at: string;
  last_seen_at: string;
  user_agent: string | null;
  persistent: boolean;
  current: boolean;
}

export const SESSIONS_KEY = ['me', 'sessions'] as const;

export function listSessions() {
  return getJson<DeviceSession[]>('/me/sessions');
}

export function revokeSession(id: string) {
  return deleteJson<null>(`/me/sessions/${encodeURIComponent(id)}`);
}

export function revokeOtherSessions() {
  return deleteJson<null>('/me/sessions');
}

export function deleteAccount(body: { password: string; confirm: 'DELETE' }) {
  return deleteJson<null>('/me', body);
}
