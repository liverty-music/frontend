import type { Scanner } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/scanner_pb.js'
import { ScannerService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/scanner/v1/scanner_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createOrganizerTransport } from './organizer-transport'

export type { Scanner }

export const IScannerClient = DI.createInterface<IScannerClient>(
	'IScannerClient',
	(x) => x.singleton(ScannerClient),
)

export interface IScannerClient extends ScannerClient {}

/**
 * Organizer-local wrapper around the generated organizer `ScannerService`:
 * the signed-in operator creates, lists and revokes the Scanners of their own
 * events. The caller's Organizer is resolved from the token. Errors propagate
 * to the screen, which translates `ConnectError` codes.
 */
export class ScannerClient {
	private readonly logger = resolve(ILogger).scopeTo('ScannerClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		ScannerService,
		createOrganizerTransport(
			this.authService,
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
		),
	)

	/** Every Scanner of the event; the link token only on UNUSED Scanners. */
	public async listByEvent(
		eventId: string,
		signal?: AbortSignal,
	): Promise<Scanner[]> {
		try {
			const res = await this.client.listByEvent(
				{ eventId: { value: eventId } },
				{ signal },
			)
			return res.scanners
		} catch (err) {
			this.logger.warn('ListByEvent failed', { eventId, error: err })
			throw err
		}
	}

	/** Creates the event's next numbered Scanner, returned with its link token. */
	public async create(eventId: string, signal?: AbortSignal): Promise<Scanner> {
		this.logger.info('Creating scanner', { eventId })
		try {
			const res = await this.client.create(
				{ eventId: { value: eventId } },
				{ signal },
			)
			if (!res.scanner) throw new Error('Create returned no scanner.')
			return res.scanner
		} catch (err) {
			this.logger.warn('Create failed', { eventId, error: err })
			throw err
		}
	}

	/** Revokes a Scanner at once and returns it. */
	public async revoke(
		scannerId: string,
		signal?: AbortSignal,
	): Promise<Scanner> {
		this.logger.info('Revoking scanner', { scannerId })
		try {
			const res = await this.client.revoke(
				{ scannerId: { value: scannerId } },
				{ signal },
			)
			if (!res.scanner) throw new Error('Revoke returned no scanner.')
			return res.scanner
		} catch (err) {
			this.logger.warn('Revoke failed', { scannerId, error: err })
			throw err
		}
	}
}
