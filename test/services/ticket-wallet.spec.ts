import { TicketSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import {
	ListRequestSchema,
	TicketService,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/ticket/v1/ticket_service_pb.js'
import {
	GetRequestSchema,
	RegisterRequestSchema,
	WalletPublicKeyService,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/wallet_public_key/v1/wallet_public_key_service_pb.js'
import { create, toBinary } from '@bufbuild/protobuf'
import { Code, ConnectError, createRouterTransport } from '@connectrpc/connect'
import { IEventAggregator, Registration } from 'aurelia'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	decodeAdmissionCode,
	SIGN_ALGORITHM,
} from '../../shared/lib/admission-code/admission-code'
import {
	ITicketRpcClient,
	TicketRpcClient,
} from '../../src/adapter/rpc/client/ticket-client'
import {
	IWalletPublicKeyRpcClient,
	WalletPublicKeyRpcClient,
} from '../../src/adapter/rpc/client/wallet-public-key-client'
import {
	IndexedDbWalletStorage,
	IWalletStorage,
} from '../../src/adapter/storage/wallet-storage'
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

const content = {
	userId: USER,
	eventId: EVENT,
	ticketIds: [TICKET],
	signTime: 1_791_000_000,
}

describe('TicketWallet', () => {
	/** Every request body sent to the server, as bytes on the wire. */
	let sent: Uint8Array[]
	/** The fan's WalletPublicKey on the server; null when none. */
	let serverKey: Uint8Array | null
	let registerCalls: number
	let getFails: boolean

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
				})
				router.service(WalletPublicKeyService, {
					get: async (req) => {
						sent.push(toBinary(GetRequestSchema, req))
						if (getFails) throw new ConnectError('down', Code.Unavailable)
						if (!serverKey) throw new ConnectError('none', Code.NotFound)
						return {
							walletPublicKey: {
								userId: { value: USER },
								publicKey: { value: serverKey },
							},
						}
					},
					register: async (req) => {
						sent.push(toBinary(RegisterRequestSchema, req))
						registerCalls++
						const key = req.publicKey?.value ?? new Uint8Array()
						const replacedOtherKey =
							serverKey !== null &&
							!(
								serverKey.length === key.length &&
								serverKey.every((v, i) => v === key[i])
							)
						serverKey = key
						return { replacedOtherKey }
					},
				})
			}),
		)
		const container = createTestContainer(
			Registration.instance(IAuthService, createMockAuth()),
			Registration.instance(IWalletStorage, storage),
			Registration.singleton(ITicketRpcClient, TicketRpcClient),
			Registration.singleton(
				IWalletPublicKeyRpcClient,
				WalletPublicKeyRpcClient,
			),
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
		serverKey = null
		registerCalls = 0
		getFails = false
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

		// First visit (Get → NotFound → Register), a reload (Get only), a move
		// back after another device took over (Get, then Register on confirm).
		expect((await wallet.checkDevice(true)).readiness).toBe('ready')
		await client.getMyTickets()
		expect((await wallet.checkDevice(true)).readiness).toBe('ready')
		serverKey = new Uint8Array(65).fill(9)
		expect((await wallet.checkDevice(true)).readiness).toBe('other-device')
		expect((await wallet.useThisDevice()).replacedOtherKey).toBe(true)
		const text = await wallet.signCode(content)

		// Created non-extractable, as an ECDSA P-256 signing key, once.
		expect(generateKey).toHaveBeenCalledTimes(1)
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

		// The registered value is exactly the 65-byte public point.
		const raw = new Uint8Array(
			await crypto.subtle.exportKey('raw', known.publicKey),
		)
		expect(serverKey).toEqual(raw)

		// Get, Register and List requests were sent; none carries the private
		// scalar.
		expect(sent.length).toBeGreaterThanOrEqual(6)
		for (const body of sent) expect(contains(body, privateScalar)).toBe(false)

		// The stored key is still non-extractable and makes verifiable codes.
		const stored = await storage.getDeviceKey()
		expect(stored?.keyPair?.privateKey.extractable).toBe(false)
		const decoded = decodeAdmissionCode(text)
		const serverPublic = await crypto.subtle.importKey(
			'raw',
			raw,
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['verify'],
		)
		expect(
			await crypto.subtle.verify(
				SIGN_ALGORITHM,
				serverPublic,
				decoded?.signature ?? new Uint8Array(),
				decoded?.signedBytes ?? new Uint8Array(),
			),
		).toBe(true)
	})

	it('registers only when the fan has no key, and only compares afterwards', async () => {
		const factory = new IDBFactory()
		const first = build(new IndexedDbWalletStorage(factory))
		expect(await first.wallet.checkDevice(true)).toEqual({
			readiness: 'ready',
			replacedOtherKey: false,
		})
		expect(registerCalls).toBe(1)

		// A later visit on the same device reads the stored key and compares.
		const later = build(new IndexedDbWalletStorage(factory))
		expect((await later.wallet.checkDevice(false)).readiness).toBe('ready')
		expect((await later.wallet.checkDevice(true)).readiness).toBe('ready')
		expect(registerCalls).toBe(1)
	})

	it('offers nothing on another device and remembers it offline', async () => {
		serverKey = new Uint8Array(65).fill(7)
		const storage = new IndexedDbWalletStorage(new IDBFactory())
		const { wallet } = build(storage)
		expect((await wallet.checkDevice(true)).readiness).toBe('other-device')
		expect(registerCalls).toBe(0)
		expect((await storage.getDeviceKey())?.keyPair).toBeNull()
		expect((await wallet.checkDevice(false)).readiness).toBe('other-device')
		await expect(wallet.signCode(content)).rejects.toThrow()
	})

	it('stops offering the code offline once another device took over', async () => {
		const storage = new IndexedDbWalletStorage(new IDBFactory())
		const { wallet } = build(storage)
		await wallet.checkDevice(true)
		serverKey = new Uint8Array(65).fill(7)
		expect((await wallet.checkDevice(true)).readiness).toBe('other-device')
		expect((await wallet.checkDevice(false)).readiness).toBe('other-device')
		await expect(wallet.signCode(content)).rejects.toThrow()
	})

	it('falls back to the last check when the key cannot be read', async () => {
		const { wallet } = build(new IndexedDbWalletStorage(new IDBFactory()))
		getFails = true
		expect((await wallet.checkDevice(true)).readiness).toBe('failed')
		getFails = false
		await wallet.checkDevice(true)
		getFails = true
		expect((await wallet.checkDevice(true)).readiness).toBe('ready')
	})

	it('needs a connection once, and cannot sign before', async () => {
		const { wallet } = build(new IndexedDbWalletStorage(new IDBFactory()))
		expect((await wallet.checkDevice(false)).readiness).toBe('needs-connection')
		await expect(wallet.signCode(content)).rejects.toThrow()
	})

	it('saves the tickets list and removes it with the key on sign-out', async () => {
		const storage = new IndexedDbWalletStorage(new IDBFactory())
		const { wallet, ea } = build(storage)
		await wallet.checkDevice(true)
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
		expect((await wallet.checkDevice(false)).readiness).toBe('needs-connection')
	})

	it('works for the session when IndexedDB is unavailable', async () => {
		const { wallet } = build(new IndexedDbWalletStorage(undefined))
		expect((await wallet.checkDevice(true)).readiness).toBe('ready')
		await expect(wallet.signCode(content)).resolves.toMatch(
			/^[0-9A-Z $%*+\-./:]+$/,
		)
		expect(await wallet.loadSnapshot()).toBeUndefined()
		await wallet.saveSnapshot({})
		await wallet.clear()
	})
})
