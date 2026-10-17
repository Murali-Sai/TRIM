export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(typeof detail === 'string' ? detail : `Request failed (${status})`);
  }

  /** A message from the server that is safe to show, or null for validation details. */
  get userMessage(): string | null {
    return typeof this.detail === 'string' ? this.detail : null;
  }
}

// Production uses the __Host- prefix (Secure cookies); local http development does not.
const CSRF_COOKIES = ['__Host-trim_csrf', 'trim_csrf'];

function readCsrfCookie(): string | null {
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=');
    if (eq > 0 && CSRF_COOKIES.includes(part.slice(0, eq))) return part.slice(eq + 1);
  }
  return null;
}

/** The double-submit CSRF token: the API sets the cookie, every write echoes it in a header. */
async function csrfToken(): Promise<string> {
  let token = readCsrfCookie();
  if (!token) {
    await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    token = readCsrfCookie();
  }
  if (!token) throw new ApiError(0, 'Cookies are needed to sign in. Turn them on and try again.');
  return token;
}

async function parse<T>(res: Response): Promise<T> {
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      data && typeof data === 'object' && 'detail' in data
        ? (data as { detail: unknown }).detail
        : null;
    throw new ApiError(res.status, detail);
  }
  return data as T;
}

export async function getJson<T>(path: string): Promise<T> {
  return parse<T>(await fetch(`/api${path}`, { credentials: 'same-origin' }));
}

export function postJson<T>(path: string, body?: unknown): Promise<T> {
  return sendJson<T>('POST', path, body);
}

export function patchJson<T>(path: string, body?: unknown): Promise<T> {
  return sendJson<T>('PATCH', path, body);
}

export function deleteJson<T>(path: string, body?: unknown): Promise<T> {
  return sendJson<T>('DELETE', path, body);
}

async function sendJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await csrfToken() },
    credentials: 'same-origin',
    body: body === undefined ? null : JSON.stringify(body),
  });
  return parse<T>(res);
}
