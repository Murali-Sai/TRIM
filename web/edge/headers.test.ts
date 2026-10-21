import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cspDirectives, gradeHeaders, headersFor, parseHeaders } from './headers';

const FILE = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8');

describe('_headers', () => {
  const rules = parseHeaders(FILE);

  it('grades A+ on every page (AC 5.4)', () => {
    for (const path of ['/', '/charts', '/account/export', '/sw.js', '/theme-init.js']) {
      expect(gradeHeaders(headersFor(rules, path)), path).toEqual([]);
    }
  });

  it('caches hashed assets for a year and keeps the security headers on them', () => {
    const h = headersFor(rules, '/assets/index-abc123.js');
    expect(h['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(gradeHeaders(h)).toEqual([]);
    expect(headersFor(rules, '/')['cache-control']).toBeUndefined();
  });

  it('allows only what the app loads', () => {
    const csp = cspDirectives(headersFor(rules, '/')['content-security-policy'] ?? '');
    expect(csp.get('script-src')).toEqual(["'self'", 'https://challenges.cloudflare.com']);
    expect(csp.get('frame-src')).toEqual(['https://challenges.cloudflare.com']);
    expect(csp.get('connect-src')).toEqual(["'self'"]);
    expect(csp.get('style-src')).toEqual(["'self'"]);
  });

  it('index.html has no inline script the policy would block', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
    expect(inline).toEqual([]);
  });
});

describe('gradeHeaders', () => {
  it('flags what a scan would', () => {
    expect(gradeHeaders({})).toContain('missing content-security-policy');
    expect(
      gradeHeaders({
        'strict-transport-security': 'max-age=300',
        'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'permissions-policy': 'camera=()',
      }),
    ).toEqual([
      'HSTS shorter than a year',
      'CSP allows inline, eval or any scripts',
      'CSP does not block plugins (object-src)',
      'CSP lets other sites frame the app',
    ]);
  });

  it('reads the file format', () => {
    expect(parseHeaders('# note\n/a/*\n  X-One: 1\n  X-Two: a: b\n/b\n  X-Three: 3\n')).toEqual([
      { pattern: '/a/*', headers: { 'x-one': '1', 'x-two': 'a: b' } },
      { pattern: '/b', headers: { 'x-three': '3' } },
    ]);
  });
});
