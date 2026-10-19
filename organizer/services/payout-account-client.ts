import { PayoutOnboardingStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/payout_account_pb.js'
import { PayoutAccountService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/payout_account/v1/payout_account_service_pb.js'
import { Code, ConnectError, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { IConsoleLanguage } from '../i18n/console-language'
import { createOrganizerTransport } from './organizer-transport'

export { PayoutOnboardingStatus }

/** The caller's payout account as the console shows it. */
export interface PayoutAccountView {
	status: PayoutOnboardingStatus
}

export const IPayoutAccountClient = DI.createInterface<IPayoutAccountClient>(
	'IPayoutAccountClient',
	(x) => x.singleton(PayoutAccountClient),
)

export interface IPayoutAccountClient extends PayoutAccountClient {}

/**
 * Organizer-local wrapper around the generated `PayoutAccountService` client:
 * the caller's payout account status, and a fresh link to the provider's
 * onboarding page. Errors propagate to callers.
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

	/** The caller's payout account, or `null` when the Organizer has none yet. */
	public async get(signal?: AbortSignal): Promise<PayoutAccountView | null> {
		try {
			const response = await this.client.get({}, { signal })
			return {
				status:
					response.payoutAccount?.status ?? PayoutOnboardingStatus.UNSPECIFIED,
			}
		} catch (err) {
			// No payout account yet is a state, not a failure.
			if (ConnectError.from(err).code === Code.NotFound) return null
			this.logger.warn('get failed', { error: err })
			throw err
		}
	}

	/**
	 * Opens the payout account when the Organizer has none and returns a fresh,
	 * single-use URL of the provider's onboarding page.
	 */
	public async startOnboarding(signal?: AbortSignal): Promise<string> {
		try {
			const response = await this.client.startOnboarding({}, { signal })
			const url = response.onboardingUrl?.value
			// Opening an empty URL would only reload the page, with no failure shown.
			if (!url) {
				throw new ConnectError('no onboarding URL in the answer', Code.Internal)
			}
			return url
		} catch (err) {
			this.logger.warn('startOnboarding failed', { error: err })
			throw err
		}
	}
}
