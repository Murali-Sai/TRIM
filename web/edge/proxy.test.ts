// @vitest-environment node
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { onRequest } from '../functions/api/[[path]]';
import { proxy, PROXY_SECRET_HEADER, type ProxyEnv } from './proxy';

const ENV: ProxyEnv = { API_ORIGIN: 'https://api.example.run.app', PROXY_SECRET: 'proxy-secret-1' };

function captureFetch(response: Response = new Response('{}', { status: 200 })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(response);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('request forwarding', () => {
  test('maps the path and query onto the API origin', async () => {
    const { calls, fetchImpl } = captureFetch();
    await proxy(
      new Request('https://app.trim.test/api/foods/search?q=rice&page=2'),
      ENV,
      fetchImpl,
    );
    expect(calls[0]?.url).toBe('https://api.example.run.app/api/foods/search?q=rice&page=2');
  });

  test('forwards method, body and ordinary headers', async () => {
    const { calls, fetchImpl } = captureFetch();
    await proxy(
      new Request('https://app.trim.test/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: 'trim_csrf=abc; trim_session=xyz',
          'x-csrf-token': 'abc',
          'user-agent': 'Test Browser',
        },
        body: JSON.stringify({ email: 'sam@example.com' }),
      }),
      ENV,
      fetchImpl,
    );
    const init: RequestInit = calls[0]?.init ?? {};
    const headers = new Headers(init.headers);
    expect(init.method).toBe('POST');
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"email":"sam@example.com"}');
    expect(headers.get('cookie')).toBe('trim_csrf=abc; trim_session=xyz');
    expect(headers.get('x-csrf-token')).toBe('abc');
    expect(headers.get('user-agent')).toBe('Test Browser');
    expect(init.redirect).toBe('manual');
  });

  test('GET and HEAD send no body', async () => {
    const { calls, fetchImpl } = captureFetch();
    await proxy(new Request('https://app.trim.test/api/me'), ENV, fetchImpl);
    expect(calls[0]?.init.body).toBeNull();
  });

  test('replaces spoofable forwarding headers with its own', async () => {
    const { calls, fetchImpl } = captureFetch();
    await proxy(
      new Request('https://app.trim.test/api/auth/login', {
        method: 'POST',
        headers: {
          'cf-connecting-ip': '203.0.113.9',
          'x-forwarded-for': '1.2.3.4',
          'x-real-ip': '1.2.3.4',
          forwarded: 'for=1.2.3.4',
          [PROXY_SECRET_HEADER]: 'guessed-secret',
        },
        body: '{}',
      }),
      ENV,
      fetchImpl,
    );
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.9');
    expect(headers.get('x-real-ip')).toBeNull();
    expect(headers.get('forwarded')).toBeNull();
    expect(headers.get(PROXY_SECRET_HEADER)).toBe('proxy-secret-1');
    expect(headers.get('x-forwarded-proto')).toBe('https');
    expect(headers.get('x-forwarded-host')).toBe('app.trim.test');
  });

  test('drops hop-by-hop and host headers', async () => {
    const { calls, fetchImpl } = captureFetch();
    await proxy(
      new Request('https://app.trim.test/api/me', {
        headers: {
          connection: 'keep-alive, x-custom-hop',
          'keep-alive': 'timeout=5',
          'x-custom-hop': '1',
        },
      }),
      ENV,
      fetchImpl,
    );
    const headers = new Headers(calls[0]?.init.headers);
    for (const name of ['connection', 'keep-alive', 'x-custom-hop', 'host']) {
      expect(headers.get(name)).toBeNull();
    }
  });
});

describe('failures', () => {
  test('unreachable API gives a 502 with a plain message', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new Error('ECONNREFUSED')),
    ) as unknown as typeof fetch;
    const res = await proxy(new Request('https://app.trim.test/api/me'), ENV, fetchImpl);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ detail: "TRIM can't be reached right now." });
  });

  test('missing configuration fails closed', async () => {
    const { calls, fetchImpl } = captureFetch();
    const res = await proxy(
      new Request('https://app.trim.test/api/me'),
      { API_ORIGIN: '', PROXY_SECRET: '' },
      fetchImpl,
    );
    expect(res.status).toBe(502);
    expect(calls).toHaveLength(0);
  });

  test('paths outside /api are not proxied', async () => {
    const { calls, fetchImpl } = captureFetch();
    const res = await proxy(new Request('https://app.trim.test/apiary'), ENV, fetchImpl);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

// A real HTTP server standing in for Cloud Run, called with the real fetch.
describe('against a real HTTP server', () => {
  let server: Server;
  let env: ProxyEnv;
  const seen: {
    method?: string;
    url?: string;
    headers?: IncomingMessage['headers'];
    body?: string;
  }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        if (req.url === '/api/auth/login') {
          res.writeHead(200, [
            ['content-type', 'application/json'],
            ['set-cookie', 'trim_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000'],
            ['set-cookie', 'trim_csrf=new; Path=/; SameSite=Lax'],
          ]);
          res.end('{"status":"ok"}');
        } else if (req.url === '/api/redirect') {
          res.writeHead(302, { location: '/somewhere' });
          res.end();
        } else {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end('{"detail":"Not signed in"}');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    env = { API_ORIGIN: `http://127.0.0.1:${port}`, PROXY_SECRET: 'proxy-secret-1' };
  });

  afterAll(() => {
    server.close();
  });

  test('keeps every Set-Cookie header separate and intact', async () => {
    const res = await onRequest({
      request: new Request('https://app.trim.test/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.4' },
        body: '{"email":"sam@example.com","password":"x"}',
      }),
      env,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(res.headers.getSetCookie()).toEqual([
      'trim_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000',
      'trim_csrf=new; Path=/; SameSite=Lax',
    ]);
    const last = seen.at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.body).toBe('{"email":"sam@example.com","password":"x"}');
    expect(last?.headers?.[PROXY_SECRET_HEADER]).toBe('proxy-secret-1');
    expect(last?.headers?.['x-forwarded-for']).toBe('198.51.100.4');
  });

  test('passes error statuses through unchanged', async () => {
    const res = await onRequest({ request: new Request('https://app.trim.test/api/me'), env });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ detail: 'Not signed in' });
  });

  test('hands redirects to the browser instead of following them', async () => {
    const res = await onRequest({
      request: new Request('https://app.trim.test/api/redirect'),
      env,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/somewhere');
  });
});
