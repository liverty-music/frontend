import { CustomElement } from 'aurelia'

/**
 * Controls the stubbed My Artists route's `canLoad`, so a test can make a
 * navigation to it be cancelled (`allow = false`) or fail (`fail = true`).
 */
export const myArtistsGuard = { allow: true, fail: false }

function kebab(name: string): string {
	return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * A stand-in module for a lazily-imported route: one custom element that
 * renders `<p data-route="<name>">`, so the real router can load and display it
 * without the route's full component tree. Use from a `vi.mock` factory:
 * `vi.mock('…/about-route', () => import('…/route-stubs').then((m) => m.routeModule('AboutRoute')))`.
 */
export function routeModule(exportName: string): Record<string, unknown> {
	const name = kebab(exportName)
	const Type =
		exportName === 'MyArtistsRoute'
			? class {
					canLoad(): boolean {
						if (myArtistsGuard.fail) throw new Error('guard failed')
						return myArtistsGuard.allow
					}
				}
			: class {}
	return {
		[exportName]: CustomElement.define(
			{ name, template: `<p data-route="${name}"></p>` },
			Type,
		),
	}
}
