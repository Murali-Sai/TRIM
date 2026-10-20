import { describe, expect, it } from 'vitest';
import { keyBytes, pushSupport } from './push';

describe('push helpers', () => {
  it('decodes a URL-safe base64 VAPID key', () => {
    // "hello?" is aGVsbG8_ in URL-safe base64 without padding.
    expect(Array.from(keyBytes('aGVsbG8_'))).toEqual([104, 101, 108, 108, 111, 63]);
    expect(Array.from(keyBytes('AQID'))).toEqual([1, 2, 3]);
  });

  it('says when an iPhone needs TRIM on the Home Screen first', () => {
    const iphone = {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    } as Navigator;
    const win = { matchMedia: () => ({ matches: false }) } as unknown as Window;
    expect(pushSupport(iphone, win)).toBe('ios-home-screen');
    const desktop = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' } as Navigator;
    expect(pushSupport(desktop, win)).toBe('unsupported');
    const chrome = {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141',
      serviceWorker: {},
    } as unknown as Navigator;
    const pushWin = {
      matchMedia: () => ({ matches: false }),
      PushManager: {},
      Notification: {},
    } as unknown as Window;
    expect(pushSupport(chrome, pushWin)).toBe('ok');
  });
});
