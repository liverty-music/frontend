// Starts the /config.json request while index.html is still being parsed, so
// it overlaps with loading and evaluating the app's entry script instead of
// following it (several hundred milliseconds on a slow phone). loadAppConfig
// (shared/config/app-config.ts) takes the request over. A classic script: the
// page's CSP allows same-origin scripts but not inline ones.
window.__configRequest = fetch('/config.json', {
	cache: 'no-store',
	signal: AbortSignal.timeout(5000),
})
// A failure is reported by loadAppConfig when it takes the request over.
window.__configRequest.catch(function () {})
