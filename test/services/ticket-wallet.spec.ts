import { TicketSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import {
	ListRequestSchema,
	RegisterWalletPublicKeyRequestSchema,
	RegisterWalletPublicKeyResponseSchema,
	TicketService,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/ticket/v1/ticket_service_pb.js'
import { create, toBinary } from '@bufbuild/protobuf'
import { createRouterTransport } from '@connectrpc/connect'
import { IEventAggregator, Registration } from 'aurelia'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	ITicketRpcClient,
	TicketRpcClient,
} from '../../src/adapter/rpc/client/ticket-client'
import {
	IndexedDbWalletStorage,
	IWalletStorage,
} from '../../src/adapter/storage/wallet-storage'
import {
	decodeAdmissionCode,
	SIGN_ALGORITHM,
} from '../../src/lib/admission-code/admission-code'
import { IAuthService } from '../../src/services/auth-service'
import { SignedOut } from '../../src/services/events/signed-out'
import { TicketWallet } from '../../src/services/ticket-wallet'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

vi.mock('../../src/services/grpc-transport', () => ({
	createTransport: vi.fn(),
}))

import { createTransport } from '../../src/services/grpc-transport'

const USER = '019a0000-0000-7000-8000-000000000001'
const EVENT = '019a0000-0000-7000-8000-0000000000e1'
const TICKET = '019a0000-0000-7000-8000-000000000101'

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
	outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) continue outer
		}
		return true
	}
	return false
}

function base64urlToBytes(s: string): Uint8Array {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

describe('TicketWallet', () => {
	/** Every request body sent to the server, as bytes on the wire. */
	let sent: Uint8Array[]
	let registered: Uint8Array[]
	let replaced: boolean

	function build(storage: IWalletStorage) {
		vi.mocked(createTransport).mockReturnValue(
			createRouterTransport((router) => {
				router.service(TicketService, {
					list: async (req) => {
						sent.push(toBinary(ListRequestSchema, req))
						return {
							tickets: [
								create(TicketSchema, {
									id: { value: TICKET },
									holderId: { value: USER },
								}),
							],
						}
					},
					registerWalletPublicKey: async (req) => {
						sent.push(toBinary(RegisterWalletPublicKeyRequestSchema, req))
						registered.push(req.publicKey?.value ?? new Uint8Array())
						return create(RegisterWalletPublicKeyResponseSchema, {
							replacedOtherKey: replaced,
						})
					},
				})
			}),
		)
		const container = createTestContainer(
			Registration.instance(IAuthService, createMockAuth()),
			Registration.instance(IWalletStorage, storage),
			Registration.singleton(ITicketRpcClient, TicketRpcClient),
		)
		container.register(Registration.singleton(TicketWallet, TicketWallet))
		return {
			wallet: container.get(TicketWallet),
			ea: container.get(IEventAggregator),
			client: container.get(ITicketRpcClient),
		}
	}

	beforeEach(() => {
		sent = []
		registered = []
		replaced = false
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('creates a non-extractable key and never sends private key material', async () => {
		// A key pair whose private scalar the test knows: made extractable here,
		// then re-imported non-extractable exactly as the device would hold it.
		const known = await crypto.subtle.generateKey(
			{ name: 'ECDSA', namedCurve: 'P-256' },
			true,
			['sign', 'verify'],
		)
		const jwk = await crypto.subtle.exportKey('jwk', known.privateKey)
		const privateScalar = base64urlToBytes(jwk.d ?? '')
		expect(privateScalar).toHaveLength(32)
		const devicePrivate = await crypto.subtle.importKey(
			'jwk',
			jwk,
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['sign'],
		)

		const generateKey = vi
			.spyOn(crypto.subtle, 'generateKey')
			.mockResolvedValue({
				privateKey: devicePrivate,
				publicKey: known.publicKey,
			})
		const exportKey = vi.spyOn(crypto.subtle, 'exportKey')

		const storage = new IndexedDbWalletStorage(new IDBFactory())
		const { wallet, client } = build(storage)
		const prepared = await wallet.prepareDevice(true)
		expect(prepared.readiness).toBe('ready')

		// Created non-extractable, as an ECDSA P-256 signing key.
		expect(generateKey).toHaveBeenCalledWith(
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			expect.arrayContaining(['sign']),
		)
		// Only the public key is ever exported, and only in raw form.
		for (const [format, key] of exportKey.mock.calls) {
			expect(format).toBe('raw')
			expect((key as CryptoKey).type).toBe('public')
		}

		// Sign a code and make the other calls a visit makes.
		const text = await wallet.signCode({
			userId: USER,
			eventId: EVENT,
			ticketIds: [TICKET],
			signTime: 1_791_000_000,
		})
		await client.getMyTickets()
		await wallet.prepareDevice(true)

		// The registered value is exactly the 65-byte public point.
		const raw = new Uint8Array(
			await crypto.subtle.exportKey('raw', known.publicKey),
		)
		expect(registered).toHaveLength(2)
		for (const key of registered) expect(key).toEqual(raw)

		// No request carries the private scalar.
		expect(sent.length).toBeGreaterThan(0)
		for (const body of sent) expect(contains(body, privateScalar)).toBe(false)

		// The stored key is still non-extractable and makes verifiable codes.
		const stored = await storage.getDeviceKey()
		expect(stored?.keyPair.privateKey.extractable).toBe(false)
		const decoded = decodeAdmissionCode(text)
		const serverKey = await crypto.subtle.importKey(
			'raw',
			raw,
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['verify'],
		)
		expect(
			await crypto.subtle.verify(
				SIGN_ALGORITHM,
				serverKey,
				decoded?.signature ?? new Uint8Array(),
				decoded?.signedBytes ?? new Uint8Array(),
			),
		).toBe(true)
	})

	it('keeps the key across visits in IndexedDB', async () => {
		const factory = new IDBFactory()
		const first = build(new IndexedDbWalletStorage(factory))
		await first.wallet.prepareDevice(true)
		const later = build(new IndexedDbWalletStorage(factory))
		expect((await later.wallet.prepareDevice(false)).readiness).toBe('ready')
		await later.wallet.prepareDevice(true)
		expect(registered[1]).toEqual(registered[0])
	})

	it('reports the move to this device', async () => {
		replaced = true
		const { wallet } = build(new IndexedDbWalletStorage(new IDBFactory()))
		expect(await wallet.prepareDevice(true)).toEqual({
			readiness: 'ready',
			replacedOtherKey: true,
		})
	})

	it('needs a connection once, and cannot sign before', async () => {
		const { wallet } = build(new IndexedDbWalletStorage(new IDBFactory()))
		expect((await wallet.prepareDevice(false)).readiness).toBe(
			'needs-connection',
		)
		await expect(
			wallet.signCode({
				userId: USER,
				eventId: EVENT,
				ticketIds: [TICKET],
				signTime: 1,
			}),
		).rejects.toThrow()
	})

	it('saves the tickets list and removes it with the key on sign-out', async () => {
		const storage = new IndexedDbWalletStorage(new IDBFactory())
		const { wallet, ea } = build(storage)
		await wallet.prepareDevice(true)
		await wallet.saveSnapshot({ savedAt: new Date(0), groups: [] })
		expect(await wallet.loadSnapshot()).toEqual({
			savedAt: new Date(0),
			groups: [],
		})

		ea.publish(new SignedOut())
		await vi.waitFor(async () => {
			expect(await storage.getDeviceKey()).toBeUndefined()
		})
		expect(await wallet.loadSnapshot()).toBeUndefined()
		expect((await wallet.prepareDevice(false)).readiness).toBe(
			'needs-connection',
		)
	})

	it('works for the session when IndexedDB is unavailable', async () => {
		const { wallet } = build(new IndexedDbWalletStorage(undefined))
		expect((await wallet.prepareDevice(true)).readiness).toBe('ready')
		await expect(
			wallet.signCode({
				userId: USER,
				eventId: EVENT,
				ticketIds: [TICKET],
				signTime: 1,
			}),
		).resolves.toMatch(/^[0-9A-Z $%*+\-./:]+$/)
		expect(await wallet.loadSnapshot()).toBeUndefined()
		await wallet.saveSnapshot({})
		await wallet.clear()
	})
})
