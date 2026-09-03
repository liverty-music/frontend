import { afterEach, beforeAll } from 'vitest'

// Vitest's `environment: 'jsdom'` (vitest.config.ts) provides window, document,
// navigator, etc. We only need to initialize Aurelia's platform bridge.
//
// Files annotated with `// @vitest-environment node` skip jsdom entirely —
// guard BrowserPlatform setup so it only runs when window exists.
const hasDOM = typeof window !== 'undefined'

if (hasDOM) {
	// Node.js 25+ installs a non-functional experimental-webstorage `localStorage`
	// stub that shadows jsdom's working Web Storage on BOTH `globalThis` and
	// `window` (bare `localStorage.clear()` throws "is not a function"). The
	// pre-Vitest-4 fix was `execArgv: ['--no-experimental-webstorage']`, but
	// Vitest 4 no longer forwards that flag to forked workers, so install a
	// spec-compliant in-memory Web Storage over the broken stub instead.
	// See: https://github.com/vitest-dev/vitest/issues/8757
	class MemoryStorage implements Storage {
		#store = new Map<string, string>()
		get length(): number {
			return this.#store.size
		}
		clear(): void {
			this.#store.clear()
		}
		getItem(key: string): string | null {
			return this.#store.has(key) ? (this.#store.get(key) as string) : null
		}
		key(index: number): string | null {
			return Array.from(this.#store.keys())[index] ?? null
		}
		removeItem(key: string): void {
			this.#store.delete(key)
		}
		setItem(key: string, value: string): void {
			this.#store.set(String(key), String(value))
		}
	}
	// Expose the class as the global `Storage` so `vi.spyOn(Storage.prototype,
	// 'setItem')` in tests intercepts the same methods the instances below use.
	Object.defineProperty(globalThis, 'Storage', {
		value: MemoryStorage,
		configurable: true,
		writable: true,
	})
	Object.defineProperty(window, 'Storage', {
		value: MemoryStorage,
		configurable: true,
		writable: true,
	})
	for (const name of ['localStorage', 'sessionStorage'] as const) {
		const storage = new MemoryStorage()
		Object.defineProperty(globalThis, name, {
			value: storage,
			configurable: true,
			writable: true,
		})
		Object.defineProperty(window, name, {
			value: storage,
			configurable: true,
			writable: true,
		})
	}

	// jsdom does not implement `window.matchMedia`; provide a non-matching stub
	// so components that query media features (e.g. prefers-reduced-motion) and
	// tests that `vi.spyOn(window, 'matchMedia')` have a function to work with.
	if (typeof window.matchMedia !== 'function') {
		Object.defineProperty(window, 'matchMedia', {
			configurable: true,
			writable: true,
			value: (query: string): MediaQueryList =>
				({
					matches: false,
					media: query,
					onchange: null,
					addListener: () => {},
					removeListener: () => {},
					addEventListener: () => {},
					removeEventListener: () => {},
					dispatchEvent: () => false,
				}) as unknown as MediaQueryList,
		})
	}

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
