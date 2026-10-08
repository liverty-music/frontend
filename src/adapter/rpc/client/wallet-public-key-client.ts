import { WalletPublicKeyService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/wallet_public_key/v1/wallet_public_key_service_pb.js'
import {
	type Client,
	Code,
	ConnectError,
	createClient,
} from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'

export const IWalletPublicKeyRpcClient =
	DI.createInterface<IWalletPublicKeyRpcClient>(
		'IWalletPublicKeyRpcClient',
		(x) => x.singleton(WalletPublicKeyRpcClient),
	)

export interface IWalletPublicKeyRpcClient extends WalletPublicKeyRpcClient {}

/**
 * WalletPublicKeyRpcClient reads and sets the signed-in fan's WalletPublicKey:
 * the public key of their entry device, the one device whose entry QR codes
 * are admitted. Keys are the 65-byte uncompressed SEC1 point from WebCrypto
 * `exportKey('raw')`; only public keys ever travel.
 */
export class WalletPublicKeyRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('WalletPublicKeyRpcClient')
	private readonly client: Client<typeof WalletPublicKeyService>

	constructor() {
		const transport = createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		)
		this.client = createClient(WalletPublicKeyService, transport)
	}

	/**
	 * The fan's current entry device public key, or null when the fan has
	 * none (the server answers NotFound). Other failures reject.
	 */
	public async get(signal?: AbortSignal): Promise<Uint8Array | null> {
		try {
			const response = await this.client.get({}, { signal })
			return response.walletPublicKey?.publicKey?.value ?? null
		} catch (err) {
			if (ConnectError.from(err).code === Code.NotFound) return null
			this.logger.warn('WalletPublicKey Get failed', { error: err })
			throw err
		}
	}

	/**
	 * Make this public key the fan's WalletPublicKey, so this device becomes
	 * the entry device. Returns whether another device's key was replaced.
	 */
	public async register(
		publicKey: Uint8Array,
		signal?: AbortSignal,
	): Promise<{ replacedOtherKey: boolean }> {
		this.logger.info('Registering wallet public key')
		try {
			const response = await this.client.register(
				{ publicKey: { value: publicKey } },
				{ signal },
			)
			return { replacedOtherKey: response.replacedOtherKey }
		} catch (err) {
			this.logger.warn('WalletPublicKey Register failed', { error: err })
			throw err
		}
	}
}
