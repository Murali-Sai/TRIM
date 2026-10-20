/** Web Push in the browser for streak reminders (SPEC page 3, Reminders). */
import type { PushSubscriptionBody } from '../api/push';

export type PushSupport = 'ok' | 'ios-home-screen' | 'unsupported';

/** iPhone and iPad allow Web Push only once TRIM is added to the Home Screen (iOS 16.4+). */
export function pushSupport(nav: Navigator = navigator, win: Window = window): PushSupport {
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent);
  const standalone =
    win.matchMedia?.('(display-mode: standalone)').matches ||
    (nav as Navigator & { standalone?: boolean }).standalone === true;
  const has = 'serviceWorker' in nav && 'PushManager' in win && 'Notification' in win;
  if (has) return 'ok';
  return ios && !standalone ? 'ios-home-screen' : 'unsupported';
}

/** The VAPID public key (URL-safe base64) as the bytes PushManager expects. */
export function keyBytes(base64url: string): Uint8Array {
  const padded = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function b64(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export class PushDenied extends Error {}

/** Asks for permission, registers the service worker and subscribes this browser. */
export async function subscribeBrowser(publicKey: string): Promise<PushSubscriptionBody> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushDenied('Notifications are blocked.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: b64(sub.getKey('p256dh')), auth: b64(sub.getKey('auth')) },
  };
}

/** The endpoint this browser was subscribed with, after unsubscribing it; null if none. */
export async function unsubscribeBrowser(): Promise<string | null> {
  const reg = await navigator.serviceWorker?.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  await sub.unsubscribe();
  return sub.endpoint;
}
