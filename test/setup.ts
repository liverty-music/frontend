import { afterEach, beforeAll } from 'vitest'

// Vitest's `environment: 'jsdom'` (vitest.config.ts) provides window, document,
// navigator, etc. We only need to initialize Aurelia's platform bridge.
//
// Files annotated with `// @vitest-environment node` skip jsdom entirely —
// guard BrowserPlatform setup so it only runs when window exists.
//
// Note: Node.js 25+ localStorage conflict is resolved via
// execArgv: ['--no-experimental-webstorage'] in vitest.config.ts.
const hasDOM = typeof window !== 'undefined'

if (hasDOM) {
	const { BrowserPlatform } = await import('@aurelia/platform-browser')
	const { onFixtureCreated, setPlatform } = await import('@aurelia/testing')

	const fixtures: {
		stop?: (dispose?: boolean) => unknown
		tearDown?: () => unknown
	}[] = []

	beforeAll(() => {
		const platform = new BrowserPlatform(
			window as unknown as Window & typeof globalThis,
		)
		setPlatform(platform)
		BrowserPlatform.set(globalThis, platform)

		onFixtureCreated((fixture: any) => {
			fixtures.push(fixture)
		})
	})

	afterEach(async () => {
		await Promise.all(
			fixtures.map((f) => {
				const result = f.stop?.(true) ?? f.tearDown?.()
				return (result as any)?.catch?.(() => {}) ?? Promise.resolve()
			}),
		)
		fixtures.length = 0
	})
}
