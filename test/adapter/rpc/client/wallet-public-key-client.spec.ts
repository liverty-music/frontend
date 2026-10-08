import { WalletPublicKeyService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/wallet_public_key/v1/wallet_public_key_service_pb.js'
import {
	Code,
	ConnectError,
	createRouterTransport,
	type ServiceImpl,
} from '@connectrpc/connect'
import { Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { WalletPublicKeyRpcClient } from '../../../../src/adapter/rpc/client/wallet-public-key-client'
import { IAuthService } from '../../../../src/services/auth-service'
import { createTestContainer } from '../../../helpers/create-container'
import { createMockAuth } from '../../../helpers/mock-auth'

vi.mock('../../../../src/services/grpc-transport', () => ({
	createTransport: vi.fn(),
}))

import { createTransport } from '../../../../src/services/grpc-transport'

function makeClient(
	impl: Partial<ServiceImpl<typeof WalletPublicKeyService>>,
): WalletPublicKeyRpcClient {
	vi.mocked(createTransport).mockReturnValue(
		createRouterTransport((router) => {
			router.service(WalletPublicKeyService, impl)
		}),
	)
	const container = createTestContainer(
		Registration.instance(IAuthService, createMockAuth()),
	)
	container.register(
		Registration.singleton(WalletPublicKeyRpcClient, WalletPublicKeyRpcClient),
	)
	return container.get(WalletPublicKeyRpcClient)
}

const KEY = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i))

describe('WalletPublicKeyRpcClient', () => {
	it('returns the fan key', async () => {
		const client = makeClient({
			get: async () => ({ walletPublicKey: { publicKey: { value: KEY } } }),
		})
		expect(await client.get()).toEqual(KEY)
	})

	it('returns null when the fan has no key', async () => {
		const client = makeClient({
			get: async () => {
				throw new ConnectError('none', Code.NotFound)
			},
		})
		expect(await client.get()).toBeNull()
	})

	it('rejects on other failures', async () => {
		const client = makeClient({
			get: async () => {
				throw new ConnectError('down', Code.Unavailable)
			},
		})
		await expect(client.get()).rejects.toMatchObject({
			code: Code.Unavailable,
		})
	})

	it('registers the public key and reports a replaced key', async () => {
		const received: Uint8Array[] = []
		const client = makeClient({
			register: async (req) => {
				received.push(req.publicKey?.value ?? new Uint8Array())
				return { replacedOtherKey: true }
			},
		})
		expect(await client.register(KEY)).toEqual({ replacedOtherKey: true })
		expect(received[0]).toEqual(KEY)
	})

	it('propagates a register failure', async () => {
		const client = makeClient({
			register: async () => {
				throw new ConnectError('down', Code.Unavailable)
			},
		})
		await expect(client.register(KEY)).rejects.toMatchObject({
			code: Code.Unavailable,
		})
	})
})
