import { postJson } from './client';

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
