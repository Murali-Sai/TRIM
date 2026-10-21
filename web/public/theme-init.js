// Apply the theme before first paint: dark unless the user chose Light or Match device.
// A file, not an inline script, so the Content-Security-Policy can forbid inline scripts.
try {
  var t = localStorage.getItem('trim.theme');
  if (t === 'light' || t === 'system') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
