import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockAuth } from '../../helpers/mock-auth'

// Stub the generated Connect client behind createClient so the wrapper's
// request marshalling can be asserted without a real transport.
const mockRpc = {
	getByEmail: vi.fn(),
	delete: vi.fn(),
}

vi.mock('@connectrpc/connect', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@connectrpc/connect')>()
	return { ...actual, createClient: vi.fn().mockReturnValue(mockRpc) }
})

// The admin transport is exercised by its own spec; stub it here.
vi.mock('../../../admin/services/admin-transport', () => ({
	createAdminTransport: vi.fn().mockReturnValue({}),
}))

const { Code, ConnectError } = await import('@connectrpc/connect')
const { IAppConfig } = await import('../../../shared/config/app-config')
const { IAuthService } = await import('../../../shared/services/auth-service')
const { IAdminUserClient } = await import('../../../admin/services/user-client')

function resolveClient() {
	const container = DI.createContainer()
	container.register(
		Registration.instance(IAppConfig, createMockAppConfig()),
		Registration.instance(IAuthService, createMockAuth() as never),
		IAdminUserClient,
	)
	return container.get(IAdminUserClient)
}

describe('AdminUserClient', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('getByEmail wraps the address and returns the User with its blockers', async () => {
		const user = { id: { value: 'u1' } }
		const blockers = [{ kind: 1, count: 2 }]
		mockRpc.getByEmail.mockResolvedValue({ user, blockers })

		const result = await resolveClient().getByEmail('fan@example.com')

		const [req] = mockRpc.getByEmail.mock.calls.at(-1) ?? []
		expect(req.email?.value).toBe('fan@example.com')
		expect(result).toEqual({ user, blockers })
	})

	it('delete wraps the user id and propagates a refusal', async () => {
		mockRpc.delete.mockRejectedValue(
			new ConnectError('blocked', Code.FailedPrecondition),
		)
		await expect(resolveClient().delete('u1')).rejects.toMatchObject({
			code: Code.FailedPrecondition,
		})
		const [req] = mockRpc.delete.mock.calls.at(-1) ?? []
		expect(req.userId?.value).toBe('u1')
	})
})
