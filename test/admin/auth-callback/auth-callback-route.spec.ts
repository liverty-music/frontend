import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, DI, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { createMockAuth } from '../../helpers/mock-auth'

// Bind the route to a test double rather than a real UserManager (oidc-client-ts).
const mockIAuthService = DI.createInterface('IAuthService')
vi.mock('../../../shared/services/auth-service', async (importOriginal) => ({
	...(await importOriginal<
		typeof import('../../../shared/services/auth-service')
	>()),
	IAuthService: mockIAuthService,
}))

const { AuthCallbackRoute } = await import(
	'../../../admin/auth-callback/auth-callback-route'
)

type Route = InstanceType<typeof AuthCallbackRoute>

async function mount(auth: ReturnType<typeof createMockAuth>) {
	const fixture = createFixture(
		'<auth-callback-route></auth-callback-route>',
		class {},
		[AuthCallbackRoute, Registration.instance(mockIAuthService, auth)],
	)
	await fixture.startPromise
	const host = fixture.appHost.querySelector('auth-callback-route')
	if (!host) throw new Error('auth-callback-route did not render')
	return { fixture, host, vm: CustomElement.for<Route>(host).viewModel }
}

describe('Admin AuthCallbackRoute', () => {
	// @spec components/infrastructure/admin/web/global/error-messages "Sign-in callback fails"
	it('shows fixed copy and the link back, not the error text', async () => {
		const auth = createMockAuth({ isAuthenticated: false })
		auth.handleCallback = vi
			.fn()
			.mockRejectedValue(new Error('No matching state found in storage'))
		const { fixture, host, vm } = await mount(auth)

		const result = await vm.canLoad({} as never, {} as never)
		await tasksSettled()

		expect(result).toBe(true)
		expect(host.querySelector('.admin-callback-error')?.textContent).toBe(
			'Sign-in failed. Return to the console and sign in again.',
		)
		expect(host.querySelector('a')?.textContent).toBe('Return to console')
		expect(host.textContent).not.toContain('No matching state')
		await fixture.tearDown()
	})

	it('routes to welcome when a prior callback already established the session', async () => {
		const auth = createMockAuth({ isAuthenticated: true })
		auth.handleCallback = vi.fn().mockRejectedValue(new Error('replayed code'))
		const { fixture, vm } = await mount(auth)

		expect(await vm.canLoad({} as never, {} as never)).toBe('/welcome')
		expect(vm.error).toBe('')
		await fixture.tearDown()
	})
})
