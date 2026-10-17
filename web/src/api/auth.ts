import { useQuery } from '@tanstack/react-query';
import { ApiError, getJson, postJson } from './client';

export type UnitSystem = 'metric' | 'imperial';

export interface SignupRequest {
  email: string;
  password: string;
  display_name: string;
  timezone: string;
  unit_system: UnitSystem;
  turnstile_token: string;
}

export function signup(body: SignupRequest) {
  return postJson<{ status: 'check_email' }>('/auth/signup', body);
}

export function verifyEmail(token: string) {
  return postJson<{ status: 'verified' }>('/auth/verify', { token });
}

export interface LoginRequest {
  email: string;
  password: string;
  keep_signed_in: boolean;
}

export function login(body: LoginRequest) {
  return postJson<{ status: 'ok' }>('/auth/login', body);
}

export function logout() {
  return postJson<null>('/auth/logout');
}

export function resendVerify() {
  return postJson<{ status: 'sent' | 'already_verified' }>('/auth/resend-verify');
}

export interface Me {
  email: string;
  display_name: string;
  timezone: string;
  unit_system: UnitSystem;
  theme: 'system' | 'light' | 'dark';
  email_verified: boolean;
  verify_deadline: string | null;
  verify_required: boolean;
}

export const ME_KEY = ['me'] as const;

/** The signed-in user, or null when signed out. */
async function fetchMe(): Promise<Me | null> {
  try {
    return await getJson<Me>('/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 60_000, retry: 1 });
}
