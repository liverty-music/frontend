import { PayoutOnboardingStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/payout_account_pb.js'
import { PayoutAccountService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/payout_account/v1/payout_account_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { IConsoleLanguage } from '../i18n/console-language'
import { createOrganizerTransport } from './organizer-transport'

export { PayoutOnboardingStatus }

/** The caller's payout account as the console shows it. */
export interface PayoutAccountView {
	status: PayoutOnboardingStatus
	/** The provider's onboarding page, present while the account is not active. */
	onboardingUrl: string
}

export const IPayoutAccountClient = DI.createInterface<IPayoutAccountClient>(
	'IPayoutAccountClient',
	(x) => x.singleton(PayoutAccountClient),
)

export interface IPayoutAccountClient extends PayoutAccountClient {}

/**
 * Organizer-local wrapper around the generated `PayoutAccountService` client:
 * the caller's payout account status and, while it is not active, the link to
 * the provider's onboarding. Errors propagate to callers.
 */
export class PayoutAccountClient {
	private readonly logger = resolve(ILogger).scopeTo('PayoutAccountClient')
	private readonly client = createClient(
		PayoutAccountService,
		createOrganizerTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
			resolve(IConsoleLanguage),
		),
	)

	public async get(signal?: AbortSignal): Promise<PayoutAccountView> {
		try {
			const response = await this.client.get({}, { signal })
			return {
				status:
					response.payoutAccount?.status ?? PayoutOnboardingStatus.UNSPECIFIED,
				onboardingUrl: response.onboardingUrl,
			}
		} catch (err) {
			this.logger.warn('get failed', { error: err })
			throw err
		}
	}
}
