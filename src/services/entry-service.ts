import type { GetMerklePathResponse } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/entry/v1/entry_service_pb.js'
import { EntryService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/entry/v1/entry_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'

export const IEntryService = DI.createInterface<IEntryService>(
	'IEntryService',
	(x) => x.singleton(EntryServiceClient),
)

export interface IEntryService extends EntryServiceClient {}

export class EntryServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('EntryService')
	private readonly authService = resolve(IAuthService)
	private readonly entryClient = createClient(
		EntryService,
		createTransport(this.authService),
	)

	public async getMerklePath(
		eventId: string,
		userId: string,
		signal?: AbortSignal,
	): Promise<GetMerklePathResponse> {
		this.logger.info('Fetching Merkle path', { eventId, userId })
		try {
			const response = await this.entryClient.getMerklePath(
				{
					eventId: { value: eventId },
					userId: { value: userId },
				},
				{ signal },
			)
			return response
		} catch (err) {
			this.logger.warn('GetMerklePath failed', { error: err })
			throw err
		}
	}
}
