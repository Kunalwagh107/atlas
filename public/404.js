// Served by 404.html for unknown paths. Send the visitor back to the app root.
// This lives in an external file rather than inline JS so the strict
// Content-Security-Policy (script-src 'self') allows it.
(function () {
  // Root-relative, so navigation always stays same-origin.
  window.location.replace('/');
})();
