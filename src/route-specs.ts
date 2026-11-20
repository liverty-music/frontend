/**
 * Every routed fan screen: the spec that describes it and its address.
 *
 * The key is the screen's name. It names the route module
 * (`./routes/<name>/<name>-route`, or `./routes/<folder>/<file>-route` for a
 * `<folder>/<file>` key, used by the legal documents that share one spec),
 * the exported class (`<Name>Route`) and the title key (`nav.<name>` in
 * camelCase). `spec` is the route spec under
 * `components/infrastructure/fan/web/`, or `null` for a screen with no spec
 * of its own. `path` is copied from the requirement of that spec that states
 * the address (OpenSpec change `unify-fan-web-naming`, design D2), so a spec
 * change that moves an address changes this file too.
 *
 * `app-shell.ts` takes each route's path from here, and `route-specs.spec.ts`
 * fails when the route table drifts from it.
 */
export const ROUTE_SPECS = {
	welcome: { spec: 'route/welcome', path: 'welcome' },
	about: { spec: null, path: 'about' },
	'sign-in-callback': { spec: null, path: 'auth/callback' },
	'passkeys-callback': { spec: null, path: 'auth/passkeys-callback' },
	'sign-in-help': { spec: 'route/sign-in-help', path: 'sign-in-help' },
	'verify-email': { spec: 'route/verify-email', path: 'verify-email' },
	timetable: { spec: 'route/timetable', path: 'timetable' },
	concert: { spec: 'route/concert', path: 'concerts/:id' },
	checkout: { spec: 'route/checkout', path: 'concerts/:id/checkout' },
	'new-lottery-entry': {
		spec: 'route/new-lottery-entry',
		path: 'concerts/:id/lottery-entries/new',
	},
	'lottery-entries': { spec: null, path: 'concerts/:id/lottery-entries' },
	'new-resale-entry': {
		spec: 'route/new-resale-entry',
		path: 'concerts/:id/resale-entries/new',
	},
	discovery: { spec: 'route/discovery', path: 'discovery' },
	'my-artists': { spec: 'route/my-artists', path: 'my-artists' },
	consent: { spec: null, path: 'consent' },
	'identity-verification-callback': { spec: null, path: 'verify/callback' },
	'resale-entries': { spec: 'route/resale-entries', path: 'resale-entries' },
	tickets: { spec: 'route/tickets', path: 'tickets' },
	notifications: { spec: 'route/notifications', path: 'notifications' },
	settings: { spec: 'route/settings', path: 'settings' },
	passkeys: { spec: null, path: 'settings/passkeys' },
	'delete-account': {
		spec: 'route/delete-account',
		path: 'settings/delete-account',
	},
	order: { spec: null, path: 'orders/:orderId' },
	'legal/terms': { spec: 'route/legal', path: 'legal/terms' },
	'legal/privacy': { spec: 'route/legal', path: 'legal/privacy' },
	'legal/licenses': { spec: 'route/legal', path: 'legal/licenses' },
} as const satisfies Record<string, { spec: string | null; path: string }>

/** The name of a routed fan screen. */
export type RouteName = keyof typeof ROUTE_SPECS

/** The address pattern of a screen, as the route table takes it. */
export function pathOf(name: RouteName): string {
	return ROUTE_SPECS[name].path
}

/** The `nav.*` i18n key of a screen's title: `legal/terms` → `nav.legalTerms`. */
export function titleKeyOf(name: RouteName): string {
	const camel = name.replace(/[-/]([a-z])/g, (_, c: string) => c.toUpperCase())
	return `nav.${camel}`
}
