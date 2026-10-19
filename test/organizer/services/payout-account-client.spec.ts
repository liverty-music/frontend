import { PayoutOnboardingStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/payout_account_pb.js'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockAuth } from '../../helpers/mock-auth'

// Stub the generated Connect client behind createClient so the wrapper's
// mapping can be asserted without a real transport.
const mockRpc = {
	get: vi.fn(),
	startOnboarding: vi.fn(),
}

vi.mock('@connectrpc/connect', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@connectrpc/connect')>()
	return { ...actual, createClient: vi.fn().mockReturnValue(mockRpc) }
})

vi.mock('../../../organizer/services/organizer-transport', () => ({
	createOrganizerTransport: vi.fn().mockReturnValue({}),
}))

const { Code, ConnectError } = await import('@connectrpc/connect')
const { IAppConfig } = await import('../../../shared/config/app-config')
const { IAuthService } = await import('../../../shared/services/auth-service')
const { IConsoleLanguage } = await import(
	'../../../organizer/i18n/console-language'
)
const { IPayoutAccountClient } = await import(
	'../../../organizer/services/payout-account-client'
)

function resolveClient() {
	const container = DI.createContainer()
	container.register(
		Registration.instance(IAppConfig, createMockAppConfig()),
		Registration.instance(IAuthService, createMockAuth() as never),
		Registration.instance(IConsoleLanguage, {} as never),
		IPayoutAccountClient,
	)
	return container.get(IPayoutAccountClient)
}

describe('PayoutAccountClient', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('get returns the account status', async () => {
		mockRpc.get.mockResolvedValue({
			payoutAccount: { status: PayoutOnboardingStatus.PENDING },
		})

		const account = await resolveClient().get()

		expect(account).toEqual({ status: PayoutOnboardingStatus.PENDING })
	})

	it('get returns null when the Organizer has no payout account (NotFound)', async () => {
		mockRpc.get.mockRejectedValue(
			new ConnectError('no payout account', Code.NotFound),
		)

		await expect(resolveClient().get()).resolves.toBeNull()
	})

	it('get rethrows any other error', async () => {
		const err = new ConnectError('provider down', Code.Unavailable)
		mockRpc.get.mockRejectedValue(err)

		await expect(resolveClient().get()).rejects.toBe(err)
	})

	it('startOnboarding returns the onboarding URL', async () => {
		mockRpc.startOnboarding.mockResolvedValue({
			onboardingUrl: { value: 'https://connect.stripe.com/setup/1' },
		})

		await expect(resolveClient().startOnboarding()).resolves.toBe(
			'https://connect.stripe.com/setup/1',
		)
	})

	it('startOnboarding rethrows a failure', async () => {
		const err = new ConnectError('provider down', Code.Unavailable)
		mockRpc.startOnboarding.mockRejectedValue(err)

		await expect(resolveClient().startOnboarding()).rejects.toBe(err)
	})
})
