import { describe, expect, it } from 'vitest'
import {
	BLOCKING_ALLOWLIST,
	checkRouteLoading,
} from './verify-route-loading.lib'

function file(path: string, source: string) {
	return [{ path, source }]
}

describe('checkRouteLoading', () => {
	it('catches the Settings regression this check exists for', () => {
		// Verbatim shape of the bug: Settings awaited two calls, one an RPC, so
		// tapping its bottom-nav tab held the previous screen until the network
		// answered. It survived because the capability named only the three tabs
		// that existed when it was written.
		const result = checkRouteLoading(
			file(
				'src/routes/settings/settings-route.ts',
				`export class SettingsRoute {
					public async loading(): Promise<void> {
						await this.resolveNotificationToggleState()
						await this.loadVerificationStatus()
					}
				}`,
			),
		)

		expect(result.kind).toBe('failed')
		if (result.kind !== 'failed') return
		expect(result.failures).toHaveLength(2)
		expect(result.failures[0].kind).toBe('awaits-in-loading')
	})

	it('accepts the non-blocking shape my-artists documents', () => {
		const result = checkRouteLoading(
			file(
				'src/routes/my-artists/my-artists-route.ts',
				`export class MyArtistsRoute {
					public async loading(): Promise<void> {
						this.isLoading = true
						void this.loadArtists()
					}
				}`,
			),
		)

		expect(result.kind).toBe('ok')
	})

	it('ignores an await that belongs to a nested function, not to the hook', () => {
		// The hook returns before this runs, so it holds nothing.
		const result = checkRouteLoading(
			file(
				'src/routes/x/x-route.ts',
				`export class XRoute {
					public loading(): void {
						void (async () => {
							await this.load()
						})()
					}
				}`,
			),
		)

		expect(result.kind).toBe('ok')
	})

	it('catches assigning a cache read to render state in the hook', () => {
		// The dashboard's original freeze: not an await, but the same effect —
		// the component's first render then contained the whole timetable.
		const result = checkRouteLoading(
			file(
				'src/routes/dashboard/dashboard-route.ts',
				`export class DashboardRoute {
					public async loading(): Promise<void> {
						this.dateGroups = this.concertService.peekDateGroups()
					}
				}`,
			),
		)

		expect(result.kind).toBe('failed')
		if (result.kind !== 'failed') return
		expect(result.failures[0].kind).toBe('assigns-cache-in-loading')
		expect(result.failures[0].detail).toContain('dateGroups')
	})

	it('lets an allowlisted route block, so exceptions are argued once and visible', () => {
		const result = checkRouteLoading(
			file(
				'src/routes/lottery-apply/lottery-apply-route.ts',
				`export class LotteryApplyRoute {
					public async loading(): Promise<void> {
						const status = await this.identity.getMyVerificationStatus()
					}
				}`,
			),
		)

		expect(result.kind).toBe('ok')
		expect(BLOCKING_ALLOWLIST['lottery-apply-route.ts']).toBeTruthy()
	})

	it('ignores a route with no loading hook at all', () => {
		const result = checkRouteLoading(
			file('src/routes/about/about-route.ts', 'export class AboutRoute {}'),
		)

		expect(result.kind).toBe('ok')
	})
})
