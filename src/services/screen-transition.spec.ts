import { IRouterEvents } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IScreenTransition } from './screen-transition'

type Handler = () => void

/** The router's event bus, reduced to what the service listens to. */
class FakeRouterEvents {
	private readonly handlers = new Map<string, Set<Handler>>()

	public subscribe(name: string, handler: Handler) {
		const set = this.handlers.get(name) ?? new Set()
		set.add(handler)
		this.handlers.set(name, set)
		return { dispose: () => set.delete(handler) }
	}

	public publish(name: string): void {
		for (const handler of [...(this.handlers.get(name) ?? [])]) handler()
	}
}

describe('ScreenTransition', () => {
	const original = document.startViewTransition
	let events: FakeRouterEvents
	let sut: IScreenTransition
	let started: Array<{ change: string | undefined; update: () => unknown }>
	let finish: () => void

	beforeEach(() => {
		vi.useFakeTimers()
		started = []
		const container = DI.createContainer()
		events = new FakeRouterEvents()
		container.register(Registration.instance(IRouterEvents, events))
		sut = container.get(IScreenTransition)
		Object.assign(document, {
			startViewTransition: (update: () => unknown) => {
				started.push({
					change: document.documentElement.dataset.screenChange,
					update,
				})
				const finished = new Promise<void>((resolve) => {
					finish = resolve
				})
				return { ready: Promise.resolve(), finished }
			},
		})
		sut.watch()
	})

	afterEach(() => {
		vi.useRealTimers()
		Object.assign(document, { startViewTransition: original })
		delete document.documentElement.dataset.screenChange
	})

	const navigate = (name: 'start' | 'end' | 'cancel' | 'error') =>
		events.publish(`au:router:navigation-${name}`)

	// @spec components/infrastructure/fan/web/global/app-shell "Redirect and first load"
	it('does not animate the first navigation', () => {
		navigate('start')
		navigate('end')
		expect(started).toEqual([])
	})

	// @spec components/infrastructure/fan/web/global/app-shell "Route change from inside a page"
	it('animates a later navigation as a page change, until the router is done', async () => {
		navigate('start')
		navigate('end')

		navigate('start')
		expect(started.map((s) => s.change)).toEqual(['page'])
		expect(document.documentElement.dataset.screenChange).toBe('page')

		let updated = false
		void Promise.resolve(started[0].update()).then(() => {
			updated = true
		})
		await vi.advanceTimersByTimeAsync(0)
		expect(updated).toBe(false)

		navigate('end')
		await vi.advanceTimersByTimeAsync(0)
		expect(updated).toBe(true)

		finish()
		await vi.advanceTimersByTimeAsync(0)
		expect(document.documentElement.dataset.screenChange).toBeUndefined()
	})

	// @spec components/infrastructure/fan/web/global/app-shell "Going back"
	it('moves the same way when the fan goes back', async () => {
		navigate('start')
		navigate('end')

		// Forward, then back: the router publishes the same events for both.
		navigate('start')
		navigate('end')
		finish()
		await vi.advanceTimersByTimeAsync(0)
		navigate('start')
		expect(started.map((s) => s.change)).toEqual(['page', 'page'])
	})

	it('joins a redirected navigation to the transition already running', async () => {
		navigate('start')
		navigate('end')

		navigate('start')
		navigate('cancel')
		navigate('start')
		await vi.advanceTimersByTimeAsync(0)
		expect(started).toHaveLength(1)

		let updated = false
		void Promise.resolve(started[0].update()).then(() => {
			updated = true
		})
		navigate('end')
		await vi.advanceTimersByTimeAsync(0)
		expect(updated).toBe(true)
	})

	it('lets the old screen go on when the router takes too long', async () => {
		navigate('start')
		navigate('end')
		navigate('start')

		let updated = false
		void Promise.resolve(started[0].update()).then(() => {
			updated = true
		})
		await vi.advanceTimersByTimeAsync(999)
		expect(updated).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		expect(updated).toBe(true)
	})

	it('ends the transition when a navigation is cancelled and none follows', async () => {
		navigate('start')
		navigate('end')
		navigate('start')

		let updated = false
		void Promise.resolve(started[0].update()).then(() => {
			updated = true
		})
		navigate('cancel')
		await vi.advanceTimersByTimeAsync(0)
		expect(updated).toBe(true)
	})

	// @spec components/infrastructure/fan/web/global/app-shell "Tab switch"
	it('runs a tab switch as a tab change and does not start a second transition for its navigation', async () => {
		navigate('start')
		navigate('end')

		const load = vi.fn(async () => {
			navigate('start')
			navigate('end')
		})
		sut.switchTab(load)
		expect(started.map((s) => s.change)).toEqual(['tab'])

		await started[0].update()
		expect(load).toHaveBeenCalledOnce()
		expect(started).toHaveLength(1)
	})

	it('changes the screen without a transition where the browser has none', async () => {
		Object.assign(document, { startViewTransition: undefined })
		const load = vi.fn(async () => {})
		sut.switchTab(load)
		expect(load).toHaveBeenCalledOnce()
		navigate('start')
		navigate('end')
		navigate('start')
		expect(started).toEqual([])
	})
})
