import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, IEventAggregator, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { IConcertRpcClient } from '../../src/adapter/rpc/client/concert-client'
import { IIdentityVerificationRpcClient } from '../../src/adapter/rpc/client/identity-verification-client'
import { ITicketJourneyRpcClient } from '../../src/adapter/rpc/client/ticket-journey-client'
import { IUserRpcClient } from '../../src/adapter/rpc/client/user-client'
import { IAppConfig } from '../../src/config/app-config'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import type { IdentityVerification } from '../../src/entities/identity-verification'
import { IConsentService } from '../../src/lib/consent/consent-service'
import ja from '../../src/locales/ja/translation.json'
import { SettingsRoute } from '../../src/routes/settings/settings-route'
import { IAudioEngine } from '../../src/services/audio-engine'
import { IAuthService } from '../../src/services/auth-service'
import { IConcertStore } from '../../src/services/concert-store'
import { SignedOut } from '../../src/services/events/signed-out'
import { IFabMenuService } from '../../src/services/fab-menu-service'
import { IIdentityVerificationService } from '../../src/services/identity-verification-service'
import { IPushService } from '../../src/services/push-service'
import { ITicketJourneyStore } from '../../src/services/ticket-journey-store'
import { IUserStore } from '../../src/services/user-store'

const UserHomeSelectorStub = CustomElement.define(
	{
		name: 'user-home-selector',
		template: '',
		bindables: ['currentCode', 'onHomeSelected'],
	},
	class {
		public open(): void {}
	},
)
const BottomSheetStub = CustomElement.define(
	{ name: 'bottom-sheet', template: '', bindables: ['open', 'ariaLabel'] },
	class {},
)

const activeIdentityVerification: IdentityVerification = {
	id: 'iv-1',
	userId: 'user-a',
	method: 'jpki',
	providerUserId: 'provider-a',
	dedupeStrength: 'strong',
	status: 'active',
}

/**
 * The fan signs out from the settings screen. The stores are the real ones,
 * on the RPC clients' doubles; AuthService is a double whose `signOut`
 * publishes `SignedOut` before leaving, as the real one does (covered in
 * test/auth-service.spec.ts).
 */
describe('Sign-out from the settings screen (fixture)', () => {
	it('clears every per-account store, so nothing of the account stays on the device', async () => {
		const userRpc = {
			get: vi.fn(async () => ({
				id: 'user-a',
				fullName: '山田 花子',
				phoneNumber: '+819012345678',
			})),
		}
		const concertRpc = {
			listFollowed: vi.fn(async () => []),
			listByArtists: vi.fn(async () => []),
		}
		const identityVerificationRpc = {
			get: vi.fn(async () => activeIdentityVerification),
		}
		const journeyRpc = {
			list: vi.fn(async () => new Map([['event-1', 'tracking' as const]])),
		}

		let ea: IEventAggregator | undefined
		const auth = {
			isAuthenticated: true,
			user: { profile: { email: 'a@example.com', email_verified: true } },
			signOut: vi.fn(async () => {
				ea?.publish(new SignedOut())
				auth.isAuthenticated = false
			}),
		}

		const builder = createFixture
			.html('<settings-route></settings-route>')
			.deps(
				I18nConfiguration.customize((options) => {
					options.initOptions = {
						lng: 'ja',
						resources: { ja: { translation: ja } },
						fallbackLng: 'ja',
					}
				}),
				Registration.instance(IAuthService, auth),
				Registration.instance(IUserRpcClient, userRpc),
				Registration.instance(IConcertRpcClient, concertRpc),
				Registration.instance(
					IIdentityVerificationRpcClient,
					identityVerificationRpc,
				),
				Registration.instance(ITicketJourneyRpcClient, journeyRpc),
				Registration.instance(IPushService, {
					resolvePushState: vi.fn(async () => 'needs-permission'),
				}),
				Registration.instance(IRouter, { load: vi.fn() }),
				Registration.instance(IAudioEngine, { muted: false, volume: 0.5 }),
				Registration.instance(IAppConfig, { vapidPublicKey: '' }),
				Registration.instance(IConsentService, {
					analytics: true,
					sessionReplay: true,
				}),
				Registration.instance(IFabMenuService, { isLeftHanded: false }),
				UserHomeSelectorStub,
				BottomSheetStub,
				BusyOnClickCustomAttribute,
				SettingsRoute,
			)
			.build()
		const container = builder.container
		ea = container.get(IEventAggregator)

		// The signed-in account's state, as the app holds it after use.
		const userStore = container.get(IUserStore)
		const concertStore = container.get(IConcertStore)
		const identityVerifications = container.get(IIdentityVerificationService)
		const journeys = container.get(ITicketJourneyStore)
		await userStore.ensureLoaded('ja')
		await concertStore.listFollowed()
		concertStore.setDateGroups([])
		concertStore.addArtistWithConcerts('artist-1')
		await identityVerifications.get()
		await journeys.load()

		const fixture = await builder.started
		const name = fixture.appHost.querySelector<HTMLInputElement>(
			'[data-testid="settings-full-name"]',
		)
		expect(name?.value).toBe('山田 花子')

		const signOut =
			fixture.appHost.querySelector<HTMLButtonElement>('.settings-sign-out')
		signOut?.click()
		await new Promise((r) => setTimeout(r, 0))
		await tasksSettled()

		expect(auth.signOut).toHaveBeenCalledTimes(1)
		expect(userStore.current).toBeUndefined()
		expect(concertStore.peekDateGroups()).toBeNull()
		expect(concertStore.artistsWithConcertsCount).toBe(0)
		expect(identityVerifications.current).toBeUndefined()
		expect(journeys.journeyMap.size).toBe(0)

		// The concert list is read again for whoever signs in next, not served
		// from the previous account's cache.
		auth.isAuthenticated = true
		await concertStore.listFollowed()
		expect(concertRpc.listFollowed).toHaveBeenCalledTimes(2)

		await fixture.stop(true)
	})
})
