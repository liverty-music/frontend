import { describe, expect, it, vi } from 'vitest'
import { createMockAuth } from '../helpers/mock-auth'

// Stub external modules
const mockCreateConnectTransport = vi.fn().mockReturnValue({})

vi.mock('@connectrpc/connect-web', () => ({
	createConnectTransport: mockCreateConnectTransport,
}))

vi.mock('@connectrpc/connect', () => ({
	ConnectError: class ConnectError extends Error {
		code: string
		constructor(message: string, code: string) {
			super(message)
			this.code = code
		}
	},
}))

vi.mock('@opentelemetry/api', () => ({
	SpanStatusCode: { OK: 0, ERROR: 2 },
	trace: {
		getTracer: () => ({
			startActiveSpan: vi.fn(
				(_name: string, fn: (span: unknown) => unknown) => {
					const mockSpan = {
						setAttributes: vi.fn(),
						setStatus: vi.fn(),
						recordException: vi.fn(),
						end: vi.fn(),
					}
					return fn(mockSpan)
				},
			),
		}),
	},
}))

vi.mock('../../src/services/connect-error-router', () => ({
	createAuthRetryInterceptor: vi
		.fn()
		.mockReturnValue(
			(next: (req: unknown) => unknown) => (req: unknown) => next(req),
		),
	createRetryInterceptor: vi
		.fn()
		.mockReturnValue(
			(next: (req: unknown) => unknown) => (req: unknown) => next(req),
		),
}))

const { createTransport } = await import('../../src/services/grpc-transport')

describe('grpc-transport', () => {
	describe('createTransport', () => {
		it('should create a transport with interceptors', () => {
			const mockAuth = createMockAuth({ isAuthenticated: true })
			const mockLogger = {
				scopeTo: vi.fn().mockReturnThis(),
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			}

			createTransport(mockAuth as any, mockLogger as any)

			expect(mockCreateConnectTransport).toHaveBeenCalledTimes(1)
			const call = mockCreateConnectTransport.mock.calls[0][0]
			expect(call.interceptors).toHaveLength(5)
		})
	})

	describe('authInterceptor', () => {
		it('should inject Bearer token when user has access_token', async () => {
			const mockUser = {
				access_token: 'test-jwt-token',
				profile: { preferred_username: 'test' },
			}
			const mockAuth = createMockAuth({ isAuthenticated: true })
			;(mockAuth.getUserManager as ReturnType<typeof vi.fn>).mockReturnValue({
				getUser: vi.fn().mockResolvedValue(mockUser),
			})

			const mockLogger = {
				scopeTo: vi.fn().mockReturnThis(),
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			}

			createTransport(mockAuth as any, mockLogger as any)

			// Extract the authInterceptor (3rd in the array: otel, logging, auth, authRetry, retry)
			const interceptors =
				mockCreateConnectTransport.mock.calls[
					mockCreateConnectTransport.mock.calls.length - 1
				][0].interceptors

			const authInterceptor = interceptors[2]

			const mockHeaders = new Map<string, string>()
			const mockReq = {
				header: {
					set: (key: string, value: string) => mockHeaders.set(key, value),
				},
				service: { typeName: 'TestService' },
				method: { name: 'TestMethod' },
			}

			const mockNext = vi.fn().mockResolvedValue({ message: 'ok' })
			const wrappedNext = authInterceptor(mockNext)
			await wrappedNext(mockReq)

			expect(mockHeaders.get('Authorization')).toBe('Bearer test-jwt-token')
			expect(mockNext).toHaveBeenCalledWith(mockReq)
		})

		it('should not set Authorization header when no user', async () => {
			const mockAuth = createMockAuth({ isAuthenticated: false })
			;(mockAuth.getUserManager as ReturnType<typeof vi.fn>).mockReturnValue({
				getUser: vi.fn().mockResolvedValue(null),
			})

			const mockLogger = {
				scopeTo: vi.fn().mockReturnThis(),
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			}

			createTransport(mockAuth as any, mockLogger as any)

			const interceptors =
				mockCreateConnectTransport.mock.calls[
					mockCreateConnectTransport.mock.calls.length - 1
				][0].interceptors

			const authInterceptor = interceptors[2]

			const mockHeaders = new Map<string, string>()
			const mockReq = {
				header: {
					set: (key: string, value: string) => mockHeaders.set(key, value),
				},
				service: { typeName: 'TestService' },
				method: { name: 'TestMethod' },
			}

			const mockNext = vi.fn().mockResolvedValue({ message: 'ok' })
			const wrappedNext = authInterceptor(mockNext)
			await wrappedNext(mockReq)

			expect(mockHeaders.has('Authorization')).toBe(false)
			expect(mockNext).toHaveBeenCalledWith(mockReq)
		})

		it('should still call next when getUserManager throws', async () => {
			const mockAuth = createMockAuth({ isAuthenticated: true })
			;(mockAuth.getUserManager as ReturnType<typeof vi.fn>).mockReturnValue({
				getUser: vi.fn().mockRejectedValue(new Error('manager error')),
			})

			const mockLogger = {
				scopeTo: vi.fn().mockReturnThis(),
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			}

			createTransport(mockAuth as any, mockLogger as any)

			const interceptors =
				mockCreateConnectTransport.mock.calls[
					mockCreateConnectTransport.mock.calls.length - 1
				][0].interceptors

			const authInterceptor = interceptors[2]

			const mockHeaders = new Map<string, string>()
			const mockReq = {
				header: {
					set: (key: string, value: string) => mockHeaders.set(key, value),
				},
				service: { typeName: 'TestService' },
				method: { name: 'TestMethod' },
			}

			const mockNext = vi.fn().mockResolvedValue({ message: 'ok' })
			const wrappedNext = authInterceptor(mockNext)
			await wrappedNext(mockReq)

			expect(mockHeaders.has('Authorization')).toBe(false)
			expect(mockNext).toHaveBeenCalledWith(mockReq)
			expect(mockLogger.error).toHaveBeenCalled()
		})
	})
})
