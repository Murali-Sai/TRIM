/**
 * Reads a token from the URL fragment (#token=...) and removes it from the address bar.
 * Fragments are never sent to servers or in the Referer header, so email-link tokens stay out
 * of logs; clearing it keeps the token out of history and screenshots.
 */
export function takeTokenFromHash(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (token) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return token;
}
