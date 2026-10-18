import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../../helpers/create-container'
import { createMockAuth } from '../../helpers/mock-auth'

// Mock IAuthService so the route binds to a test double rather than
// constructing a real UserManager (oidc-client-ts).
const mockIAuthService = DI.createInterface('IAuthService')

vi.mock('../../../shared/services/auth-service', async (importOriginal) => ({
	...(await importOriginal<
		typeof import('../../../shared/services/auth-service')
	>()),
	IAuthService: mockIAuthService,
}))

const { AuthCallbackRoute, CALLBACK_RETRY_FLAG } = await import(
	'../../../organizer/auth-callback/auth-callback-route'
)
const { IConsoleLanguage } = await import(
	'../../../organizer/i18n/console-language'
)

const STATE_MISS = new Error('No matching state found in storage')

// The callback only completes the code exchange + the cross-context state-miss
// self-heal. The intended-org enforcement + owner-role check live in the guard
// (OrganizerAuthHook), which runs when the callback routes on.
describe('Organizer AuthCallbackRoute', () => {
	let sut: InstanceType<typeof AuthCallbackRoute>
	let mockAuth: ReturnType<typeof createMockAuth>

	function build(authOverrides: Parameters<typeof createMockAuth>[0]) {
		mockAuth = createMockAuth(authOverrides)
		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(IConsoleLanguage, { current: 'en' }),
		)
		container.register(AuthCallbackRoute)
		sut = container.get(AuthCallbackRoute)
	}

	beforeEach(() => {
		window.sessionStorage.clear()
		build({})
	})

	// @spec stories/sign-in-as-organizer "Invited owner lands on the console after accepting the invite"
	it('completes the code exchange and opens the landing, which opens Home', async () => {
		build({})
		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe('')
		expect(mockAuth.handleCallback).toHaveBeenCalledTimes(1)
	})

	it('returns to the address opened before sign-in', async () => {
		build({})
		mockAuth.handleCallback.mockResolvedValue({
			state: { returnTo: '/organizers/org-1/artists/a-1/series/s-tour' },
		} as never)
		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe('/organizers/org-1/artists/a-1/series/s-tour')
	})

	it('clears a stale retry flag on a successful callback', async () => {
		window.sessionStorage.setItem(CALLBACK_RETRY_FLAG, '1')
		build({})

		await sut.canLoad({} as never, {} as never)

		expect(window.sessionStorage.getItem(CALLBACK_RETRY_FLAG)).toBeNull()
	})

	it('self-heals a cross-context state miss by restarting sign-in once', async () => {
		build({ isAuthenticated: false })
		mockAuth.handleCallback = vi.fn().mockRejectedValue(STATE_MISS)

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe(false)
		// The restarted sign-in opens the hosted login in the console's language.
		expect(mockAuth.signIn).toHaveBeenCalledExactlyOnceWith({ uiLocales: 'en' })
		expect(window.sessionStorage.getItem(CALLBACK_RETRY_FLAG)).toBe('1')
	})

	it('does not restart sign-in a second time; shows the error instead', async () => {
		window.sessionStorage.setItem(CALLBACK_RETRY_FLAG, '1')
		build({ isAuthenticated: false })
		mockAuth.handleCallback = vi.fn().mockRejectedValue(STATE_MISS)

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
		expect(sut.failed).toBe(true)
	})

	it('does not restart sign-in for a non-recoverable callback error', async () => {
		build({ isAuthenticated: false })
		mockAuth.handleCallback = vi
			.fn()
			.mockRejectedValue(new Error('token endpoint 500'))

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
		expect(sut.failed).toBe(true)
	})

	it('recovers to the landing (Home) when a prior callback already established the session', async () => {
		build({ isAuthenticated: true })
		mockAuth.handleCallback = vi.fn().mockRejectedValue(STATE_MISS)

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe('')
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})
})

describe('Organizer AuthCallbackRoute page', () => {
	beforeEach(() => {
		window.sessionStorage.clear()
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	// @spec components/infrastructure/organizer/web/global/error-messages "Sign-in callback fails"
	it('shows fixed copy and the sign-in link, not the error text', async () => {
		const { ConsoleI18nConfiguration } = await import(
			'../../../organizer/i18n/console-language'
		)
		const { ConsoleButton } = await import(
			'../../../organizer/ui/console-button/console-button'
		)
		const mockAuth = createMockAuth({ isAuthenticated: false })
		mockAuth.handleCallback = vi
			.fn()
			.mockRejectedValue(new Error('invalid_grant: code expired'))
		const fixture = createFixture(
			'<auth-callback-route></auth-callback-route>',
			class {},
			[
				ConsoleI18nConfiguration,
				ConsoleButton,
				AuthCallbackRoute,
				Registration.instance(mockIAuthService, mockAuth),
			],
		)
		await fixture.startPromise
		const host = fixture.appHost.querySelector('auth-callback-route')
		if (!host) throw new Error('auth-callback-route did not render')
		const vm =
			CustomElement.for<InstanceType<typeof AuthCallbackRoute>>(host).viewModel

		await vm.canLoad({} as never, {} as never)
		await tasksSettled()

		expect(host.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
			'サインインできませんでした。',
		)
		expect(host.textContent).toContain('もう一度サインインする')
		expect(host.textContent).not.toContain('invalid_grant')
		await fixture.tearDown()
	})
})
