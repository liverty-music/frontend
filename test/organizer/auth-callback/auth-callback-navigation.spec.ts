import { IRouter, RouterConfiguration, route } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, DI, Registration } from 'aurelia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockAuth } from '../../helpers/mock-auth'

/**
 * The callback's return value goes through the REAL router, over a route
 * table shaped like the console's around the callback (the landing is the
 * empty path and the fallback, as in `organizer-shell.ts`), so a path the
 * router cannot read as an instruction fails here: the landing `/` once did,
 * and the console crashed after every sign-in without a return address
 * (liverty-music/frontend#752). The other screens are stubs; the console's
 * full table is not imported because its eager `import()`s would load every
 * screen.
 */

const screen = (name: string) =>
	CustomElement.define(
		{ name, template: `<p data-route="${name}"></p>` },
		class {},
	)

// The real callback route, bound to a test double of the auth service.
const mockIAuthService = DI.createInterface('IAuthService')
vi.mock('../../../shared/services/auth-service', async (importOriginal) => ({
	...(await importOriginal<
		typeof import('../../../shared/services/auth-service')
	>()),
	IAuthService: mockIAuthService,
}))

const { AuthCallbackRoute } = await import(
	'../../../organizer/auth-callback/auth-callback-route'
)

const routes = [
	{ id: 'landing', path: '', component: screen('landing-route') },
	{ path: 'organizers/:organizerId', component: screen('home-route') },
	{
		path: 'organizers/:organizerId/settings',
		component: screen('settings-route'),
	},
	{
		path: 'auth/callback',
		component: AuthCallbackRoute,
		data: { auth: false },
	},
]

@route({ fallback: 'landing', routes })
class Root {}

describe('organizer callback navigation (real router)', () => {
	let fixture: Awaited<ReturnType<typeof render>> | null = null

	async function render(auth: ReturnType<typeof createMockAuth>) {
		const f = createFixture('<au-viewport></au-viewport>', Root, [
			RouterConfiguration,
			Registration.instance(mockIAuthService, auth),
		])
		await f.started
		return f
	}

	/**
	 * Opens an Organizer screen, then the callback, as a browser returning
	 * from the identity provider does. Returns the screen shown and the error
	 * the navigation failed with, if any.
	 */
	async function signInReturning(auth: ReturnType<typeof createMockAuth>) {
		window.history.replaceState(null, '', '/')
		fixture = await render(auth)
		const router = fixture.container.get(IRouter)
		await router.load('organizers/o-9')
		await tasksSettled()
		let error: unknown = null
		try {
			await router.load('auth/callback')
		} catch (err) {
			error = err
		}
		await tasksSettled()
		const shown = fixture.appHost
			.querySelector('[data-route]')
			?.getAttribute('data-route')
		return { shown, error, location: window.location.pathname }
	}

	afterEach(async () => {
		await fixture?.stop(true)
		fixture = null
		window.sessionStorage.clear()
		window.history.replaceState(null, '', '/')
	})

	it('opens the landing after a sign-in without a return address', async () => {
		const result = await signInReturning(createMockAuth({}))

		expect(result.error).toBeNull()
		expect(result.shown).toBe('landing-route')
		expect(result.location).toBe('/')
	})

	it('opens the landing for the return address /', async () => {
		const auth = createMockAuth({})
		auth.handleCallback = vi.fn().mockResolvedValue({
			state: { returnTo: '/' },
		})

		const result = await signInReturning(auth)

		expect(result.error).toBeNull()
		expect(result.shown).toBe('landing-route')
	})

	it('opens the landing for a sign-in link /?org=<short name>', async () => {
		const auth = createMockAuth({})
		auth.handleCallback = vi.fn().mockResolvedValue({
			state: { returnTo: '/?org=e2e-test' },
		})

		const result = await signInReturning(auth)

		expect(result.error).toBeNull()
		expect(result.shown).toBe('landing-route')
	})

	it('opens the landing for a stored return-to / after a forced re-auth', async () => {
		const auth = createMockAuth({})
		auth.takeReturnTo = vi.fn().mockReturnValue('/')

		const result = await signInReturning(auth)

		expect(result.error).toBeNull()
		expect(result.shown).toBe('landing-route')
	})

	it('opens the landing when a prior callback already signed in', async () => {
		const auth = createMockAuth({ isAuthenticated: true })
		auth.handleCallback = vi
			.fn()
			.mockRejectedValue(new Error('No matching state found in storage'))

		const result = await signInReturning(auth)

		expect(result.error).toBeNull()
		expect(result.shown).toBe('landing-route')
	})

	it('opens the address opened before sign-in', async () => {
		const auth = createMockAuth({})
		auth.handleCallback = vi.fn().mockResolvedValue({
			state: { returnTo: '/organizers/o-1/settings' },
		})

		const result = await signInReturning(auth)

		expect(result.error).toBeNull()
		expect(result.shown).toBe('settings-route')
		expect(result.location).toBe('/organizers/o-1/settings')
	})
})
