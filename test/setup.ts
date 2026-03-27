import { BrowserPlatform } from '@aurelia/platform-browser'
import { type IFixture, onFixtureCreated, setPlatform } from '@aurelia/testing'
import { afterEach, beforeAll } from 'vitest'

// Vitest's `environment: 'jsdom'` (vitest.config.ts) provides window, document,
// navigator, etc. We only need to initialize Aurelia's platform bridge.
//
// Note: Node.js 25+ localStorage conflict is resolved via
// execArgv: ['--no-experimental-webstorage'] in vitest.config.ts.
function bootstrapTestEnv() {
	const platform = new BrowserPlatform(
		window as unknown as Window & typeof globalThis,
	)
	setPlatform(platform)
	BrowserPlatform.set(globalThis, platform)
}

const fixtures: IFixture<object>[] = []
beforeAll(() => {
	bootstrapTestEnv()
	onFixtureCreated((fixture) => {
		fixtures.push(fixture)
	})
})

afterEach(async () => {
	await Promise.all(
		fixtures.map((f) => {
			const result = f.stop?.(true) ?? (f as any).tearDown?.()
			return result?.catch?.(() => {}) ?? Promise.resolve()
		}),
	)
	fixtures.length = 0
})
