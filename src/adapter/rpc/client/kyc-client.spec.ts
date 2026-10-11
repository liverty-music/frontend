import {
	DedupeStrength,
	VerificationMethod,
	VerificationStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/kyc_pb.js'
import { VerificationLevel } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import {
	type CreateResponse,
	CreateResponseSchema,
	type GetResponse,
	GetResponseSchema,
	KycService,
	type StartResponse,
	StartResponseSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/kyc/v1/kyc_service_pb.js'
import { create } from '@bufbuild/protobuf'
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
// tests we bypass it: the client constructor receives a router-backed transport.
vi.mock('../../../services/grpc-transport', () => ({
	createTransport: vi.fn(),
}))

import { createTransport } from '../../../services/grpc-transport'
import { KycRpcClient } from './kyc-client'

const activeKyc = {
	id: { value: 'kyc-1' },
	userId: { value: 'user-1' },
	method: VerificationMethod.JPKI,
	pocketSignUserId: { value: 'ps-user-1' },
	dedupeStrength: DedupeStrength.STRONG,
	status: VerificationStatus.ACTIVE,
}

/** Build a client wired to a router transport serving the given handlers. */
function makeClient(handlers: {
	get?: () => Promise<GetResponse>
	start?: () => Promise<StartResponse>
	create?: (req: { sessionId: string }) => Promise<CreateResponse>
}) {
	const transport = createRouterTransport((router) => {
		router.service(KycService, {
			get: handlers.get ?? (async () => create(GetResponseSchema)),
			start: handlers.start ?? (async () => create(StartResponseSchema)),
			create:
				handlers.create ??
				(async () =>
					create(CreateResponseSchema, {
						verificationLevel: VerificationLevel.KYC_VERIFIED,
					})),
		})
	})
	vi.mocked(createTransport).mockReturnValue(transport)
	return new KycRpcClient()
}

describe('KycRpcClient', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('start', () => {
		it('returns sessionId and redirectUrl from the response', async () => {
			const client = makeClient({
				start: async () =>
					create(StartResponseSchema, {
						sessionId: 'sess-abc-123',
						redirectUrl: {
							value: 'https://pocketsign.example.com/stamp/sess-abc-123',
						},
					}),
			})

			const result = await client.start('jpki')

			expect(result.sessionId).toBe('sess-abc-123')
			expect(result.redirectUrl).toBe(
				'https://pocketsign.example.com/stamp/sess-abc-123',
			)
		})

		it('throws when redirect_url is absent', async () => {
			const client = makeClient({
				start: async () =>
					create(StartResponseSchema, { sessionId: 'sess-no-url' }),
			})

			await expect(client.start('jpki')).rejects.toThrow(
				'Start: server returned a StartResponse without a redirect_url',
			)
		})

		it('throws when redirect_url.value is empty', async () => {
			const client = makeClient({
				start: async () =>
					create(StartResponseSchema, {
						sessionId: 'sess-empty-url',
						redirectUrl: { value: '' },
					}),
			})

			await expect(client.start('jpki')).rejects.toThrow(
				'Start: server returned a StartResponse without a redirect_url',
			)
		})

		it('propagates a ConnectError', async () => {
			const client = makeClient({
				start: async () => {
					throw new ConnectError('PocketSign not configured', Code.Unavailable)
				},
			})

			await expect(client.start('jpki')).rejects.toThrow(ConnectError)
		})
	})

	describe('create', () => {
		it('sends the session id as-is', async () => {
			let capturedSessionId: string | undefined
			const client = makeClient({
				create: async (req) => {
					capturedSessionId = req.sessionId
					return create(CreateResponseSchema, {
						verificationLevel: VerificationLevel.KYC_VERIFIED,
					})
				},
			})

			await client.create('sess-42')

			expect(capturedSessionId).toBe('sess-42')
		})

		it('maps the level and the Kyc to the domain type', async () => {
			const client = makeClient({
				create: async () =>
					create(CreateResponseSchema, {
						verificationLevel: VerificationLevel.KYC_VERIFIED,
						kyc: activeKyc,
					}),
			})

			const status = await client.create('sess-42')

			expect(status.level).toBe('kycVerified')
			expect(status.kyc?.id).toBe('kyc-1')
			expect(status.kyc?.method).toBe('jpki')
		})

		it('propagates a ConnectError', async () => {
			const client = makeClient({
				create: async () => {
					throw new ConnectError('session expired', Code.FailedPrecondition)
				},
			})

			await expect(client.create('sess-42')).rejects.toThrow(ConnectError)
		})
	})

	describe('get', () => {
		it('maps the caller Kyc', async () => {
			const client = makeClient({
				get: async () => create(GetResponseSchema, { kyc: activeKyc }),
			})

			const kyc = await client.get()

			expect(kyc?.id).toBe('kyc-1')
			expect(kyc?.dedupeStrength).toBe('strong')
		})

		it('returns undefined when the fan never passed KYC (NotFound)', async () => {
			const client = makeClient({
				get: async () => {
					throw new ConnectError('no kyc', Code.NotFound)
				},
			})

			await expect(client.get()).resolves.toBeUndefined()
		})

		it('propagates any other ConnectError', async () => {
			const client = makeClient({
				get: async () => {
					throw new ConnectError('unavailable', Code.Unavailable)
				},
			})

			await expect(client.get()).rejects.toThrow(ConnectError)
		})
	})
})
