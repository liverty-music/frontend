/**
 * Where the e2e suite finds the dev server. `playwright.config.mjs` starts
 * the server on this port and builds every project's `baseURL` from it, so
 * `E2E_PORT=<port> npx playwright test` runs a worktree in isolation instead
 * of testing whatever server another worktree left on the default port.
 *
 * Specs navigate with relative URLs (`page.goto('/dashboard')`); use
 * `APP_ORIGIN` only where no `baseURL` applies, such as a context made with
 * `browser.newContext()` or a match on a full URL.
 */
export const E2E_PORT = Number(process.env.E2E_PORT || 9000)

export const APP_ORIGIN = `http://localhost:${E2E_PORT}`
