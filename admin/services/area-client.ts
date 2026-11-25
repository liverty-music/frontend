import type {
	Area,
	TimeZoneOption,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/area_pb.js'
import { AreaService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/area/v1/area_service_pb.js'
import { Code, ConnectError, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type { Area, TimeZoneOption }

/** What a venue in one country is confirmed from. */
export interface CountryAreas {
	readonly areas: Area[]
	readonly timeZones: TimeZoneOption[]
}

export const IAreaClient = DI.createInterface<IAreaClient>('IAreaClient', (x) =>
	x.singleton(AreaClient),
)

export interface IAreaClient extends AreaClient {}

/**
 * Admin-local wrapper around the admin `AreaService`: resolves an area the
 * reviewer typed (a code, or a name in English or Japanese) to its first-level
 * Area, and lists a country's Areas and time zones for the approval queue's
 * time zone select. A country's list is reference data, so it is read once per
 * page.
 */
export class AreaClient {
	private readonly logger = resolve(ILogger).scopeTo('AreaClient')
	private readonly client = createClient(
		AreaService,
		createAdminTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('AdminTransport'),
			resolve(IAppConfig),
		),
	)
	private readonly countries = new Map<string, Promise<CountryAreas>>()

	/**
	 * Returns the first-level Area the text stands for, or null when it stands
	 * for none or for more than one (NotFound). Other failures are thrown.
	 */
	public async resolve(text: string): Promise<Area | null> {
		try {
			const response = await this.client.resolve({ area: { value: text } })
			return response.area ?? null
		} catch (err) {
			if (err instanceof ConnectError && err.code === Code.NotFound) return null
			this.logger.warn('resolve failed', { text, error: err })
			throw err
		}
	}

	/** Returns a country's first-level Areas and time zones. */
	public listByCountry(countryCode: string): Promise<CountryAreas> {
		let pending = this.countries.get(countryCode)
		if (!pending) {
			pending = this.client
				.listByCountry({ countryCode: { value: countryCode } })
				.then((r) => ({ areas: r.areas, timeZones: r.timeZones }))
			pending.catch((err: unknown) => {
				// A failed read is not kept, so the next row asks again.
				this.countries.delete(countryCode)
				this.logger.warn('listByCountry failed', { countryCode, error: err })
			})
			this.countries.set(countryCode, pending)
		}
		return pending
	}
}
