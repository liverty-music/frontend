import { describe, expect, it, vi } from 'vitest'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockAuth } from '../../helpers/mock-auth'

const mockCreateConnectTransport = vi.fn().mockReturnValue({})

vi.mock('@connectrpc/connect-web', () => ({
	createConnectTransport: mockCreateConnectTransport,
}))

const { createAdminTransport } = await import(
	'../../../admin/services/admin-transport'
)

function mockLogger() {
	return {
		scopeTo: vi.fn().mockReturnThis(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}
}

describe('admin-transport', () => {
	describe('createAdminTransport', () => {
		it('targets the dedicated admin API host when adminApiBaseUrl is set', () => {
			const config = createMockAppConfig({
				apiBaseUrl: 'https://api.test.local',
				adminApiBaseUrl: 'https://api.admin.test.local',
			})

			createAdminTransport(
				createMockAuth({ isAuthenticated: true }) as any,
				mockLogger() as any,
				config,
			)

			const call = mockCreateConnectTransport.mock.calls.at(-1)?.[0]
			expect(call.baseUrl).toBe('https://api.admin.test.local')
			// Auth + logging only — no consumer OTEL/retry interceptors.
			expect(call.interceptors).toHaveLength(2)
		})

		it('falls back to apiBaseUrl when adminApiBaseUrl is absent', () => {
			const config = createMockAppConfig({
				apiBaseUrl: 'https://api.test.local',
			})
			expect(config.adminApiBaseUrl).toBeUndefined()

			createAdminTransport(
				createMockAuth({ isAuthenticated: true }) as any,
				mockLogger() as any,
				config,
			)

			const call = mockCreateConnectTransport.mock.calls.at(-1)?.[0]
			expect(call.baseUrl).toBe('https://api.test.local')
		})
	})
})
