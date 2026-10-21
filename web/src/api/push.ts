import { deleteJson, getJson, postJson } from './client';

export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** null public_key: the server has no VAPID keys, so reminders cannot be turned on. */
export function getPushConfig() {
  return getJson<{ public_key: string | null }>('/push/config');
}

export function saveSubscription(body: PushSubscriptionBody) {
  return postJson<null>('/push/subscriptions', body);
}

export function deleteSubscription(endpoint: string) {
  return deleteJson<null>(`/push/subscriptions?endpoint=${encodeURIComponent(endpoint)}`);
}
