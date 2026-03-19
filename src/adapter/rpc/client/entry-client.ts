import { EntryService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/entry/v1/entry_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import type { MerklePath } from '../../../entities/entry'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'

export const IEntryRpcClient = DI.createInterface<IEntryRpcClient>(
	'IEntryRpcClient',
	(x) => x.singleton(EntryRpcClient),
)

export interface IEntryRpcClient extends EntryRpcClient {}

export class EntryRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('EntryService')
	private readonly entryClient = createClient(
		EntryService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
		),
	)

	public async getMerklePath(
		eventId: string,
		signal?: AbortSignal,
	): Promise<MerklePath> {
		this.logger.info('Fetching Merkle path', { eventId })
		try {
			const response = await this.entryClient.getMerklePath(
				{ eventId: { value: eventId } },
				{ signal },
			)
			return {
				pathElements: response.pathElements.map((bytes) =>
					bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
				),
				pathIndices: [...response.pathIndices],
				merkleRoot:
					response.merkleRoot instanceof Uint8Array
						? response.merkleRoot
						: new Uint8Array(response.merkleRoot),
				leaf:
					response.leaf instanceof Uint8Array
						? response.leaf
						: new Uint8Array(response.leaf),
			}
		} catch (err) {
			this.logger.warn('GetMerklePath failed', { error: err })
			throw err
		}
	}
}
