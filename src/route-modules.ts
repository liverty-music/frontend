import { NavigationStrategy } from '@aurelia/router'

/** A route component's module, as the router takes it from a navigation strategy. */
export type RouteModule = Awaited<
	Extract<
		ReturnType<ConstructorParameters<typeof NavigationStrategy>[0]>,
		Promise<unknown>
	>
>

/** Runs a callback when the main thread is idle, at the latest after a while. */
export type IdleScheduler = (callback: () => void) => void

const whenIdle: IdleScheduler = (callback) => {
	if (typeof requestIdleCallback === 'function') {
		requestIdleCallback(callback, { timeout: 5000 })
	} else {
		setTimeout(callback, 200)
	}
}

/**
 * Route components imported when they are first needed instead of when the
 * route table is built.
 *
 * A route whose `component` is an `import()` promise makes the router wait
 * for every such promise before it recognizes the first URL, so each screen's
 * module was downloaded and evaluated before the first route could paint
 * (frames of 63-153 ms at 4x CPU throttling; design D10 of
 * `smooth-discovery-and-faster-start-up`). `lazyRoute` defers the import to
 * the route's first navigation through a navigation strategy, and `prefetch`
 * imports the deferred modules one per idle moment once the first route is on
 * screen, so a later switch finds its module loaded. The router keeps a
 * navigation-strategy route out of its navigation model, so bottom-navigation
 * tabs keep their `import()`.
 */
export function createRouteModules(idle: IdleScheduler = whenIdle): {
	lazyRoute: (load: () => Promise<RouteModule>) => NavigationStrategy
	prefetch: () => void
} {
	const loaders: (() => Promise<RouteModule>)[] = []
	return {
		lazyRoute(load) {
			let module: Promise<RouteModule> | undefined
			const get = (): Promise<RouteModule> => {
				// A failed import is retried on the next request.
				module ??= load().catch((err: unknown) => {
					module = undefined
					throw err
				})
				return module
			}
			loaders.push(get)
			return new NavigationStrategy(get)
		},
		prefetch() {
			const pending = [...loaders]
			const next = (): void => {
				const load = pending.shift()
				if (!load) return
				// A failure is left to the route's own navigation.
				load().then(
					() => idle(next),
					() => idle(next),
				)
			}
			idle(next)
		},
	}
}
