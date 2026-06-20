import { describe, expect, it } from 'vitest'
import approvalQueueHtml from '../../admin/approval-queue/approval-queue-route.html?raw'
import approvedConcertsHtml from '../../admin/approved-concerts/approved-concerts-route.html?raw'
import authCallbackHtml from '../../admin/auth-callback/auth-callback-route.html?raw'
import welcomeHtml from '../../admin/welcome/welcome-route.html?raw'

/**
 * Regression guard for AUR3401. The admin routes (welcome, approval-queue,
 * auth/callback) are all SIBLINGS under `admin-shell`. A `load="/route"`
 * (root-absolute) inside a child component resolves against that child's own
 * routing context — Aurelia looks for the target as a CHILD route and fails:
 *
 *   AUR3401: Neither the route 'approval-queue' matched any configured route
 *   at 'admin-shell/welcome-route' ...
 *
 * Per the Aurelia 2 router docs, sibling navigation from a child uses the
 * parent-context `../` prefix. These assertions pin every admin nav link to
 * that form so the leading-slash variant cannot be reintroduced.
 */
describe('admin sibling navigation uses parent-relative paths', () => {
	const cases: ReadonlyArray<[name: string, html: string, target: string]> = [
		['welcome-route', welcomeHtml, '../approval-queue'],
		['approval-queue-route', approvalQueueHtml, '../welcome'],
		['approved-concerts-route', approvedConcertsHtml, '../welcome'],
		['auth-callback-route', authCallbackHtml, '../welcome'],
	]

	for (const [name, html, expectedTarget] of cases) {
		it(`${name} navigates to a sibling via ${expectedTarget}`, () => {
			// The intended sibling-nav target is present...
			expect(html).toContain(`load="${expectedTarget}"`)
			// ...and no root-absolute load (the AUR3401 trap) remains.
			expect(html).not.toMatch(/load="\/[a-z]/)
		})
	}
})
