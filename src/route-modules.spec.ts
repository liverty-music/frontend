import { NavigationStrategy } from '@aurelia/router'
import { describe, expect, it, vi } from 'vitest'
import { createRouteModules, type RouteModule } from './route-modules'

/** The navigation strategy's component, as the router asks for it. */
function component(strategy: NavigationStrategy): Promise<RouteModule> {
	return (
		strategy as unknown as { getComponent: () => Promise<RouteModule> }
	).getComponent()
}

const module = (name: string) => ({ default: name }) as unknown as RouteModule

describe('createRouteModules', () => {
	it('imports a route module only when the router first asks for it, and once', async () => {
		const { lazyRoute } = createRouteModules(() => {})
		const load = vi.fn(async () => module('event'))

		const strategy = lazyRoute(load)

		expect(strategy).toBeInstanceOf(NavigationStrategy)
		expect(load).not.toHaveBeenCalled()
		await expect(component(strategy)).resolves.toEqual(module('event'))
		await component(strategy)
		expect(load).toHaveBeenCalledOnce()
	})

	it('retries a failed import on the next navigation', async () => {
		const { lazyRoute } = createRouteModules(() => {})
		const load = vi
			.fn<() => Promise<RouteModule>>()
			.mockRejectedValueOnce(new Error('chunk 404'))
			.mockResolvedValueOnce(module('event'))
		const strategy = lazyRoute(load)

		await expect(component(strategy)).rejects.toThrow('chunk 404')
		await expect(component(strategy)).resolves.toEqual(module('event'))
	})

	it('prefetches the deferred modules one per idle moment, past a failure', async () => {
		const idle: (() => void)[] = []
		const { lazyRoute, prefetch } = createRouteModules((cb) => {
			idle.push(cb)
		})
		const loads = [
			vi.fn(async () => module('a')),
			vi.fn(async () => {
				throw new Error('offline')
			}),
			vi.fn(async () => module('c')),
		]
		for (const load of loads) lazyRoute(load)

		prefetch()
		for (let step = 0; step < 3; step++) {
			expect(loads.filter((l) => l.mock.calls.length > 0)).toHaveLength(step)
			idle.shift()?.()
			await Promise.resolve()
			await Promise.resolve()
			await Promise.resolve()
		}

		expect(loads.every((l) => l.mock.calls.length === 1)).toBe(true)
	})
})
