import { Url } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/entity_pb.js'
import {
	UserId,
	VerificationLevel,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import {
	DedupeStrength,
	VerificationMethod,
	VerificationStatus,
	VerifiedIdentity,
	VerifiedIdentityId,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/verified_identity_pb.js'
import {
	CompleteVerifyResponse,
	GetMyVerificationStatusResponse,
	StartVerifyResponse,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/identity/v1/identity_verification_service_pb.js'
import { IdentityVerificationService as IdentityVerificationServiceDef } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/identity/v1/identity_verification_service_connect.js'
import { Code, ConnectError, createRouterTransport } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock must be hoisted; factories must not reference out-of-scope bindings
// directly, so we inline all DI stubs inside the factory.
vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const tokenAny = token as { friendlyName?: string }
			const name = tokenAny.friendlyName ?? ''
			const fakeLogger = {
				scopeTo: (_s: string) => ({
					debug: vi.fn(),
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
				}),
			}
			if (name === 'ILogger') return fakeLogger
			if (name === 'IAuthService')
				return { getUserManager: () => ({ getUser: async () => null }) }
			if (name === 'IAppConfig')
				return { apiBaseUrl: 'https://api.test.example.com' }
			return {}
		}),
	}
})

// createTransport is the production factory (ConnectTransport over HTTP). In
// tests we bypass it entirely: we intercept the import so the client constructor
// receives our router-backed transport instead.
vi.mock('../../../services/grpc-transport', () => ({
	// The mock is replaced per-test via mockImplementation below. We expose a
	// vi.fn() stub so individual tests can inject their own transport.
	createTransport: vi.fn(),
}))

import { createTransport } from '../../../services/grpc-transport'
import { IdentityVerificationRpcClient } from './identity-verification-client'

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a router transport that handles all three RPC methods used by the
 * client. Each handler is a vi.fn() so tests can override it with
 * `.mockImplementationOnce(...)`.
 */
function makeRouterTransport(handlers: {
	getMyVerificationStatus?: (
		req: GetMyVerificationStatusResponse,
	) => GetMyVerificationStatusResponse
	startVerify?: () => StartVerifyResponse
	completeVerify?: () => CompleteVerifyResponse
}) {
	return createRouterTransport((router) => {
		router.service(IdentityVerificationServiceDef, {
			getMyVerificationStatus: async (_req) =>
				handlers.getMyVerificationStatus
					? handlers.getMyVerificationStatus(
							new GetMyVerificationStatusResponse(),
						)
					: new GetMyVerificationStatusResponse({
							verificationLevel: VerificationLevel.UNVERIFIED,
						}),
			startVerify: async (_req) =>
				handlers.startVerify
					? handlers.startVerify()
					: new StartVerifyResponse(),
			completeVerify: async (_req) =>
				handlers.completeVerify
					? handlers.completeVerify()
					: new CompleteVerifyResponse({
							verificationLevel: VerificationLevel.IDENTITY_VERIFIED,
						}),
		})
	})
}

/** Build a client wired to the given router transport. */
function makeClient(transport: ReturnType<typeof createRouterTransport>) {
	vi.mocked(createTransport).mockReturnValue(transport)
	return new IdentityVerificationRpcClient()
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('IdentityVerificationRpcClient', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// ── startVerify ────────────────────────────────────────────────────────────

	describe('startVerify', () => {
		it('happy path: returns sessionId and redirectUrl from the response', async () => {
			const transport = makeRouterTransport({
				startVerify: () =>
					new StartVerifyResponse({
						sessionId: 'sess-abc-123',
						redirectUrl: new Url({
							value: 'https://pocketsign.example.com/stamp/sess-abc-123',
						}),
					}),
			})
			const client = makeClient(transport)

			const result = await client.startVerify('user-1', 'jpki')

			expect(result.sessionId).toBe('sess-abc-123')
			expect(result.redirectUrl).toBe(
				'https://pocketsign.example.com/stamp/sess-abc-123',
			)
		})

		it('guard: throws when redirect_url is absent (nil field)', async () => {
			const transport = makeRouterTransport({
				startVerify: () =>
					new StartVerifyResponse({
						sessionId: 'sess-no-url',
						// redirectUrl intentionally absent
					}),
			})
			const client = makeClient(transport)

			await expect(client.startVerify('user-1', 'jpki')).rejects.toThrow(
				'StartVerify: server returned a StartVerifyResponse without a redirect_url',
			)
		})

		it('guard: throws when redirect_url.value is empty string', async () => {
			const transport = makeRouterTransport({
				startVerify: () =>
					new StartVerifyResponse({
						sessionId: 'sess-empty-url',
						redirectUrl: new Url({ value: '' }),
					}),
			})
			const client = makeClient(transport)

			await expect(client.startVerify('user-1', 'jpki')).rejects.toThrow(
				'StartVerify: server returned a StartVerifyResponse without a redirect_url',
			)
		})

		it('propagates an RPC ConnectError thrown by the transport', async () => {
			const transport = createRouterTransport((router) => {
				router.service(IdentityVerificationServiceDef, {
					startVerify: async () => {
						throw new ConnectError(
							'PocketSign not configured',
							Code.Unavailable,
						)
					},
				})
			})
			const client = makeClient(transport)

			await expect(client.startVerify('user-1', 'jpki')).rejects.toThrow(
				ConnectError,
			)
		})
	})

	// ── completeVerify ─────────────────────────────────────────────────────────

	describe('completeVerify', () => {
		it('sends userId wrapped in UserId and sessionId NOT swapped', async () => {
			// Capture the raw proto request to assert the field values.
			let capturedUserId: string | undefined
			let capturedSessionId: string | undefined

			const transport = createRouterTransport((router) => {
				router.service(IdentityVerificationServiceDef, {
					completeVerify: async (req) => {
						capturedUserId = req.userId?.value
						capturedSessionId = req.sessionId
						return new CompleteVerifyResponse({
							verificationLevel: VerificationLevel.IDENTITY_VERIFIED,
						})
					},
				})
			})
			const client = makeClient(transport)

			await client.completeVerify('user-1', 'sess-42')

			// userId must be wrapped in the UserId proto message
			expect(capturedUserId).toBe('user-1')
			// sessionId must be passed through as-is — NOT swapped with userId
			expect(capturedSessionId).toBe('sess-42')
		})

		it('maps the response verification level and identity to the domain type', async () => {
			const transport = makeRouterTransport({
				completeVerify: () =>
					new CompleteVerifyResponse({
						verificationLevel: VerificationLevel.IDENTITY_VERIFIED,
						// verifiedIdentityFrom() returns undefined when pocketSignUserId is
						// absent; include all required fields to get a non-undefined identity.
						verifiedIdentity: new VerifiedIdentity({
							id: new VerifiedIdentityId({ value: 'vi-99' }),
							accountRef: new UserId({ value: 'user-1' }),
							method: VerificationMethod.JPKI,
							pocketSignUserId: { value: 'ps-user-99' },
							dedupeStrength: DedupeStrength.STRONG,
							status: VerificationStatus.ACTIVE,
						}),
					}),
			})
			const client = makeClient(transport)

			const status = await client.completeVerify('user-1', 'sess-42')

			expect(status.level).toBe('identityVerified')
			expect(status.identity?.id).toBe('vi-99')
			expect(status.identity?.method).toBe('jpki')
		})

		it('propagates an RPC ConnectError thrown by the transport', async () => {
			const transport = createRouterTransport((router) => {
				router.service(IdentityVerificationServiceDef, {
					completeVerify: async () => {
						throw new ConnectError('session expired', Code.FailedPrecondition)
					},
				})
			})
			const client = makeClient(transport)

			await expect(client.completeVerify('user-1', 'sess-42')).rejects.toThrow(
				ConnectError,
			)
		})
	})

	// ── getMyVerificationStatus ────────────────────────────────────────────────

	describe('getMyVerificationStatus', () => {
		it('maps UNVERIFIED level correctly', async () => {
			const transport = makeRouterTransport({
				getMyVerificationStatus: () =>
					new GetMyVerificationStatusResponse({
						verificationLevel: VerificationLevel.UNVERIFIED,
					}),
			})
			const client = makeClient(transport)

			const status = await client.getMyVerificationStatus('user-1')

			expect(status.level).toBe('unverified')
			expect(status.identity).toBeUndefined()
		})

		it('maps IDENTITY_VERIFIED level with a populated identity', async () => {
			const transport = makeRouterTransport({
				getMyVerificationStatus: () =>
					new GetMyVerificationStatusResponse({
						verificationLevel: VerificationLevel.IDENTITY_VERIFIED,
						// verifiedIdentityFrom() returns undefined when pocketSignUserId is
						// absent; include all required fields to get a non-undefined identity.
						verifiedIdentity: new VerifiedIdentity({
							id: new VerifiedIdentityId({ value: 'vi-1' }),
							accountRef: new UserId({ value: 'user-1' }),
							method: VerificationMethod.JPKI,
							pocketSignUserId: { value: 'ps-user-1' },
							dedupeStrength: DedupeStrength.STRONG,
							status: VerificationStatus.ACTIVE,
						}),
					}),
			})
			const client = makeClient(transport)

			const status = await client.getMyVerificationStatus('user-1')

			expect(status.level).toBe('identityVerified')
			expect(status.identity?.id).toBe('vi-1')
			expect(status.identity?.dedupeStrength).toBe('strong')
		})

		it('propagates an RPC ConnectError thrown by the transport', async () => {
			const transport = createRouterTransport((router) => {
				router.service(IdentityVerificationServiceDef, {
					getMyVerificationStatus: async () => {
						throw new ConnectError('permission denied', Code.PermissionDenied)
					},
				})
			})
			const client = makeClient(transport)

			await expect(client.getMyVerificationStatus('user-1')).rejects.toThrow(
				ConnectError,
			)
		})
	})
})
