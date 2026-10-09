/**
 * Import-boundary enforcement for the consumer (`src/`), admin (`admin/`),
 * organizer (`organizer/`), reception (`reception/`), and the single shared
 * surface (`shared/`). See OpenSpec changes `add-admin-console` /
 * `organizer-console`, design D2/D3 and the "import boundary erosion" risk,
 * and `isolate-venue-reception`, design D4.
 *
 * Directional rules:
 *   - `src/`, `admin/`, `organizer/`, `reception/` are mutually isolated (no
 *     cross-imports)
 *   - all four MAY import `shared/`, except that `reception/` MUST NOT reach
 *     `shared/services/auth-service` (the OIDC client), directly or through
 *     another module
 *   - `shared/` MUST NOT import `src/`, `admin/`, `organizer/` or
 *     `reception/` (it stays a leaf)
 *
 * Wired into `make lint` and CI via `npm run lint:boundaries`. A cross-import
 * fails the build (exit code non-zero).
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: 'src-not-to-admin',
			comment:
				'Consumer code (src/) must not import admin-only code (admin/). Cross-app code goes through shared/.',
			severity: 'error',
			from: { path: '^src/' },
			to: { path: '^admin/' },
		},
		{
			name: 'admin-not-to-src',
			comment:
				'Admin code (admin/) must not import consumer code (src/). Cross-app code goes through shared/.',
			severity: 'error',
			from: { path: '^admin/' },
			to: { path: '^src/' },
		},
		{
			name: 'src-not-to-organizer',
			comment:
				'Consumer code (src/) must not import organizer-only code (organizer/). Cross-app code goes through shared/.',
			severity: 'error',
			from: { path: '^src/' },
			to: { path: '^organizer/' },
		},
		{
			name: 'organizer-not-to-src',
			comment:
				'Organizer code (organizer/) must not import consumer code (src/). Cross-app code goes through shared/.',
			severity: 'error',
			from: { path: '^organizer/' },
			to: { path: '^src/' },
		},
		{
			name: 'admin-not-to-organizer',
			comment:
				'Admin code (admin/) must not import organizer-only code (organizer/). The two consoles are independent surfaces.',
			severity: 'error',
			from: { path: '^admin/' },
			to: { path: '^organizer/' },
		},
		{
			name: 'organizer-not-to-admin',
			comment:
				'Organizer code (organizer/) must not import admin-only code (admin/). The two consoles are independent surfaces.',
			severity: 'error',
			from: { path: '^organizer/' },
			to: { path: '^admin/' },
		},
		{
			name: 'shared-is-a-leaf',
			comment:
				'shared/ is the single cross-app import surface and must stay a leaf: it must not import src/, admin/, or organizer/.',
			severity: 'error',
			from: { path: '^shared/' },
			to: { path: '^(src|admin|organizer|reception)/' },
		},
		// The reception app is served on its own origin and must never be able
		// to touch console sign-in state (isolate-venue-reception, design D4).
		{
			name: 'reception-not-to-other-apps',
			comment:
				'Reception code (reception/) must not import the consumer (src/), admin (admin/) or organizer (organizer/) code. Cross-app code goes through shared/.',
			severity: 'error',
			from: { path: '^reception/' },
			to: { path: '^(src|admin|organizer)/' },
		},
		{
			name: 'reception-not-to-auth-service',
			comment:
				'Reception code (reception/) must not reach shared/services/auth-service (the OIDC client and console tokens), directly or transitively. The reception app has no sign-in.',
			severity: 'error',
			from: { path: '^reception/' },
			to: { path: '^shared/services/auth-service', reachable: true },
		},
		{
			name: 'other-apps-not-to-reception',
			comment:
				'Consumer, admin and organizer code must not import reception-only code (reception/); it ships in its own build and image.',
			severity: 'error',
			from: { path: '^(src|admin|organizer)/' },
			to: { path: '^reception/' },
		},
		// Tests live under test/ (mirroring src/) and test/admin/ (admin-side).
		// Enforce the same boundary there so erosion can't re-enter via the test
		// tree: a consumer-side test must not reach into admin/, and an
		// admin-side test must not reach into src/.
		{
			name: 'consumer-test-not-to-admin',
			comment:
				'Consumer-side tests (test/, excluding test/admin/) must not import admin-only code (admin/).',
			severity: 'error',
			from: { path: '^test/', pathNot: '^test/admin/' },
			to: { path: '^admin/' },
		},
		{
			name: 'admin-test-not-to-src',
			comment:
				'Admin-side tests (test/admin/) must not import consumer code (src/).',
			severity: 'error',
			from: { path: '^test/admin/' },
			to: { path: '^src/' },
		},
		{
			name: 'consumer-test-not-to-organizer',
			comment:
				'Consumer-side tests (test/, excluding test/organizer/) must not import organizer-only code (organizer/).',
			severity: 'error',
			from: { path: '^test/', pathNot: '^test/organizer/' },
			to: { path: '^organizer/' },
		},
		{
			name: 'organizer-test-not-to-src',
			comment:
				'Organizer-side tests (test/organizer/) must not import consumer code (src/).',
			severity: 'error',
			from: { path: '^test/organizer/' },
			to: { path: '^src/' },
		},
		{
			name: 'reception-test-not-to-other-apps',
			comment:
				'Reception-side tests (test/reception/) must not import consumer, admin or organizer code.',
			severity: 'error',
			from: { path: '^test/reception/' },
			to: { path: '^(src|admin|organizer)/' },
		},
		{
			name: 'other-tests-not-to-reception',
			comment:
				'Tests outside test/reception/ must not import reception-only code (reception/).',
			severity: 'error',
			from: { path: '^test/', pathNot: '^test/reception/' },
			to: { path: '^reception/' },
		},
	],
	options: {
		doNotFollow: { path: 'node_modules' },
		tsConfig: { fileName: 'tsconfig.json' },
		tsPreCompilationDeps: true,
		enhancedResolveOptions: {
			extensions: ['.ts', '.js', '.mjs', '.cjs', '.html'],
		},
		// Only report on first-party source under the five roots + tests.
		includeOnly: '^(src|admin|organizer|reception|shared|test)/',
	},
}
