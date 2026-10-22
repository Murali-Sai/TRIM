/**
 * Same-origin proxy (SPEC page 2, "One origin"): the browser only talks to the app's own
 * domain, and this forwards /api/* to the FastAPI service on Render. The session cookie
 * is therefore first-party, which Safari requires.
 *
 * Kept free of Cloudflare-specific types so it runs and is tested under Node too.
 */

export interface ProxyEnv {
  /** API service origin, for example https://trim-api.onrender.com */
  API_ORIGIN: string;
  /** Shared secret the API checks, so nobody can bypass this proxy or fake client IPs. */
  PROXY_SECRET: string;
}

export const PROXY_SECRET_HEADER = 'x-trim-proxy-secret';

// Connection-level headers that must not be forwarded (RFC 9110, section 7.6.1).
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

// Headers a caller could use to spoof where a request came from; the proxy sets its own.
const CLIENT_SUPPLIED_FORWARDING = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  PROXY_SECRET_HEADER,
];

function stripped(headers: Headers, names: string[]): Headers {
  const out = new Headers(headers);
  for (const name of names) out.delete(name);
  // Headers listed in Connection are hop-by-hop too.
  for (const name of (headers.get('connection') ?? '').split(',')) {
    if (name.trim()) out.delete(name.trim());
  }
  return out;
}

function unreachable(): Response {
  return new Response(JSON.stringify({ detail: "TRIM can't be reached right now." }), {
    status: 502,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function proxy(
  request: Request,
  env: ProxyEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!env.API_ORIGIN || !env.PROXY_SECRET) return unreachable();

  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith('/api/')) {
    return new Response('Not found', { status: 404 });
  }
  const target = new URL(incoming.pathname + incoming.search, env.API_ORIGIN);

  const headers = stripped(request.headers, [...HOP_BY_HOP, ...CLIENT_SUPPLIED_FORWARDING]);
  headers.delete('host');
  // Cloudflare sets CF-Connecting-IP to the real client; the browser cannot override it.
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) headers.set('x-forwarded-for', clientIp);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));
  headers.set('x-forwarded-host', incoming.host);
  headers.set(PROXY_SECRET_HEADER, env.PROXY_SECRET);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetchImpl(target.toString(), {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : null,
      // Pass redirects to the browser as they are; never follow them here.
      redirect: 'manual',
    });
  } catch {
    return unreachable();
  }

  const responseHeaders = stripped(upstream.headers, HOP_BY_HOP);
  // Set-Cookie can repeat; copy each one, never a comma-joined string.
  responseHeaders.delete('set-cookie');
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookie);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
