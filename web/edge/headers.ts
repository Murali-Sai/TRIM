/**
 * The site's response headers (task 5.4): read Cloudflare Pages' `_headers` format, find the
 * headers for a path, and grade a set of headers the way securityheaders.com does.
 */

export interface HeaderRule {
  /** A path pattern such as "/*" or "/assets/*" ("*" matches anything). */
  pattern: string;
  headers: Record<string, string>;
}

/** Parses `_headers`: a path line, then indented "Name: value" lines; # starts a comment. */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      rules.push({ pattern: raw.trim(), headers: {} });
      continue;
    }
    const rule = rules.at(-1);
    const colon = raw.indexOf(':');
    if (!rule || colon < 0) continue;
    rule.headers[raw.slice(0, colon).trim().toLowerCase()] = raw.slice(colon + 1).trim();
  }
  return rules;
}

function matches(pattern: string, path: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map(escape).join('.*')}$`);
  return re.test(path);
}

function escape(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** Every matching rule's headers, later rules adding to earlier ones (as Pages does). */
export function headersFor(rules: readonly HeaderRule[], path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rules) if (matches(r.pattern, path)) Object.assign(out, r.headers);
  return out;
}

const REQUIRED = [
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
] as const;

/** Directive name to its sources. */
export function cspDirectives(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out.set(name.toLowerCase(), sources);
  }
  return out;
}

/**
 * Problems a securityheaders.com-style scan would flag; none means an A+. Headers are keyed in
 * lower case.
 */
export function gradeHeaders(headers: Record<string, string>): string[] {
  const problems: string[] = REQUIRED.filter((h) => !headers[h]).map((h) => `missing ${h}`);
  const age = /max-age=(\d+)/.exec(headers['strict-transport-security'] ?? '')?.[1];
  if (Number(age ?? 0) < 31_536_000) problems.push('HSTS shorter than a year');
  const csp = cspDirectives(headers['content-security-policy'] ?? '');
  const scripts = csp.get('script-src') ?? csp.get('default-src') ?? [];
  if (scripts.some((s) => s === "'unsafe-inline'" || s === "'unsafe-eval'" || s === '*')) {
    problems.push('CSP allows inline, eval or any scripts');
  }
  if (!csp.has('default-src')) problems.push('CSP has no default-src');
  if ((csp.get('object-src') ?? csp.get('default-src'))?.join(' ') !== "'none'") {
    problems.push('CSP does not block plugins (object-src)');
  }
  if (csp.get('frame-ancestors')?.join(' ') !== "'none'") {
    problems.push('CSP lets other sites frame the app');
  }
  if (headers['x-content-type-options'] !== 'nosniff') problems.push('nosniff missing');
  return problems;
}
