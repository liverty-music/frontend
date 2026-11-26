import { afterAll, beforeAll, vi } from 'vitest'

/**
 * Run a file's (or a describe block's) tests with the browser set to `zone`:
 * the viewer's zone the fan app formats in. CI runs in UTC.
 */
export function useViewerZone(zone: string): void {
	let before: string | undefined
	beforeAll(() => {
		before = process.env.TZ
		vi.stubEnv('TZ', zone)
	})
	afterAll(() => {
		if (before === undefined) delete process.env.TZ
		else process.env.TZ = before
	})
}
