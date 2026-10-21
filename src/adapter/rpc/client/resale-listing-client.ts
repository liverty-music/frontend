import { ResaleListingService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/resale_listing/v1/resale_listing_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { ResaleListing } from '../../../entities/resale-listing'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import { resaleListingFrom } from '../mapper/resale-listing-mapper'

export const IResaleListingRpcClient =
	DI.createInterface<IResaleListingRpcClient>('IResaleListingRpcClient', (x) =>
		x.singleton(ResaleListingRpcClient),
	)

export interface IResaleListingRpcClient extends ResaleListingRpcClient {}

/**
 * The signed-in fan's official resale (公式リセール) listings
 * (`ResaleListingService`). The fan is the caller; no request names them.
 * ConnectErrors propagate to the caller, which tells the fan what happened.
 */
export class ResaleListingRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('ResaleListingRpcClient')
	private readonly client = createClient(
		ResaleListingService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		),
	)

	/** All of the fan's listings, newest first. Empty when there are none. */
	public async list(signal?: AbortSignal): Promise<ResaleListing[]> {
		const resp = await this.client.list({}, { signal })
		return resp.resaleListings.map(resaleListingFrom)
	}

	/** Lists one of the fan's tickets for official resale. */
	public async create(
		ticketId: string,
		signal?: AbortSignal,
	): Promise<ResaleListing> {
		this.logger.info('Listing a ticket for resale', { ticketId })
		const resp = await this.client.create(
			{ ticketId: { value: ticketId } },
			{ signal },
		)
		if (!resp.resaleListing) throw new Error('Create returned no listing')
		return resaleListingFrom(resp.resaleListing)
	}

	/** Takes back one of the fan's listings. */
	public async withdraw(
		resaleListingId: string,
		signal?: AbortSignal,
	): Promise<ResaleListing> {
		this.logger.info('Withdrawing a resale listing', { resaleListingId })
		const resp = await this.client.withdraw(
			{ resaleListingId: { value: resaleListingId } },
			{ signal },
		)
		if (!resp.resaleListing) throw new Error('Withdraw returned no listing')
		return resaleListingFrom(resp.resaleListing)
	}
}
