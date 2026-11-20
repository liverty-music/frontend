import { NavigationStrategy } from '@aurelia/router'
import { describe, expect, it } from 'vitest'
import { routes, type ShellRouteData } from './app-shell'
import en from './locales/en/translation.json'
import ja from './locales/ja/translation.json'
import { ROUTE_SPECS, type RouteName, titleKeyOf } from './route-specs'

interface TableRoute {
	id?: string
	path: string | string[]
	redirectTo?: string
	component?: unknown
	data?: ShellRouteData
}

const table = routes as TableRoute[]
const screens = table.filter((r) => r.redirectTo === undefined)

/** `new-lottery-entry` → `NewLotteryEntry`; `legal/terms` → `Terms`. */
function className(name: string): string {
	const last = name.split('/').at(-1) ?? name
	return `${last.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase())}Route`
}

/** `timetable` → `timetable/timetable-route`; `legal/terms` → `legal/terms-route`. */
function modulePath(name: string): string {
	return name.includes('/') ? `${name}-route` : `${name}/${name}-route`
}

const modules = import.meta.glob<Record<string, unknown>>(
	'./routes/**/*-route.ts',
)

/** The module the route's component imports, eager or lazy. */
async function componentModule(
	route: TableRoute,
): Promise<Record<string, unknown>> {
	const component = route.component
	if (component instanceof NavigationStrategy) {
		return (
			component as unknown as {
				getComponent: () => Promise<Record<string, unknown>>
			}
		).getComponent()
	}
	return (await component) as Record<string, unknown>
}

// OpenSpec change `unify-fan-web-naming`, design D2: the route table follows
// the list of spec names and addresses, so a renamed screen or a moved address
// that one of them misses fails here.
describe('route specs', () => {
	it('has one route for every listed screen and no other', () => {
		expect(screens.map((r) => r.id).sort()).toEqual(
			Object.keys(ROUTE_SPECS).sort(),
		)
	})

	describe.each(Object.keys(ROUTE_SPECS) as RouteName[])('%s', (name) => {
		const route = () => {
			const found = screens.find((r) => r.id === name)
			if (!found) throw new Error(`no route for ${name}`)
			return found
		}

		it('is served at the address of its spec', () => {
			expect(route().path).toBe(ROUTE_SPECS[name].path)
		})

		it('takes its title from nav.<name>', () => {
			expect(route().data?.titleKey).toBe(titleKeyOf(name))
		})

		it('imports ./routes/<name>/<name>-route, which exports <Name>Route', async () => {
			const path = `./routes/${modulePath(name)}.ts`
			expect(Object.keys(modules)).toContain(path)
			const module = await componentModule(route())
			const expected = await modules[path]()
			expect(module).toBe(expected)
			expect(Object.keys(module)).toContain(className(name))
		})
	})

	// @spec components/infrastructure/fan/web/global/i18n "Screen titles are invariant across locales"
	it('titles every screen with the same English in Japanese and English', () => {
		const navOf = (catalog: { nav: Record<string, string> }, key: string) =>
			catalog.nav[key.replace(/^nav\./, '')]
		for (const name of Object.keys(ROUTE_SPECS) as RouteName[]) {
			const key = titleKeyOf(name)
			expect(navOf(en, key), key).toBeTruthy()
			expect(navOf(ja, key), key).toBe(navOf(en, key))
		}
		expect(navOf(ja, 'nav.notFound')).toBe(navOf(en, 'nav.notFound'))
	})
})
