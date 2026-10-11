import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { EventSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { SeriesSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { CustomElement, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ICheckoutRpcClient } from '../../src/adapter/rpc/client/checkout-client'
import { IConcertRpcClient } from '../../src/adapter/rpc/client/concert-client'
import { ITicketSaleRpcClient } from '../../src/adapter/rpc/client/ticket-sale-client'
import type { Checkout } from '../../src/entities/checkout'
import type { IdentityVerification } from '../../src/entities/identity-verification'
import type { TicketSale } from '../../src/entities/ticket-sale'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { CheckoutRoute } from '../../src/routes/checkout/checkout-route'
import { IIdentityVerificationService } from '../../src/services/identity-verification-service'
import { INotificationManager } from '../../src/services/notification-manager'
import { IPushService } from '../../src/services/push-service'
import { IPwaInstallService } from '../../src/services/pwa-install-service'
import { IStripeService } from '../../src/services/stripe-service'
import { IUserStore } from '../../src/services/user-store'

const EVENT_ID = 'event-1'

/** The event's first-come sale, open now, that admits JPKI-verified fans only. */
const jpkiOnlySale: TicketSale = {
	id: 'sale-1',
	name: '一般発売',
	method: 'firstCome',
	saleStartTime: new Date(Date.now() - 60 * 60 * 1000),
	saleEndTime: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
	verificationRequirement: 'jpkiOnly',
	ticketType: {
		id: 'type-1',
		eventId: EVENT_ID,
		price: 3000,
		perAccountLimit: 4,
		state: 'onSale',
		lowStock: false,
	},
}

const concert = {
	event: create(EventSchema, {
		id: { value: EVENT_ID },
		localDate: { value: { year: 2026, month: 11, day: 20 } },
		listedVenueName: { value: 'Shibuya WWW' },
		seriesId: { value: 's1' },
	}),
	series: create(SeriesSchema, {
		id: { value: 's1' },
		title: { value: 'ONE MAN LIVE' },
	}),
	artists: [],
}

const held: Checkout = {
	id: 'checkout-1',
	ticketTypeId: 'type-1',
	ticketCount: 1,
	amount: 3000,
	status: 'held',
	holdExpireTime: new Date(Date.now() + 15 * 60 * 1000),
}

const activeJpki: IdentityVerification = {
	id: 'iv-1',
	userId: 'user-1',
	method: 'jpki',
	providerUserId: 'provider-1',
	dedupeStrength: 'strong',
	status: 'active',
}

/**
 * Renders the real checkout template with the real translation bundles, for
 * a fan with the given IdentityVerification (none when undefined), and waits
 * for the first step.
 */
async function render(
	lng: 'ja' | 'en',
	identityVerification: IdentityVerification | undefined,
) {
	const checkoutClient = {
		start: vi.fn().mockResolvedValue(held),
		get: vi.fn(),
		authorizeCard: vi.fn(),
		confirm: vi.fn(),
	}
	const router = { load: vi.fn() }
	const fixture = await createFixture(
		'<checkout-route></checkout-route>',
		class App {},
		[
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng,
					resources: { ja: { translation: ja }, en: { translation: en } },
					fallbackLng: 'ja',
				}
			}),
			Registration.instance(IConcertRpcClient, {
				get: vi.fn().mockResolvedValue(concert),
			}),
			Registration.instance(ITicketSaleRpcClient, {
				listByEvent: vi.fn().mockResolvedValue([jpkiOnlySale]),
			}),
			Registration.instance(ICheckoutRpcClient, checkoutClient),
			Registration.instance(IStripeService, { isConfigured: true }),
			Registration.instance(IIdentityVerificationService, {
				get: vi.fn().mockResolvedValue(identityVerification),
			}),
			Registration.instance(IUserStore, {
				current: undefined,
				currentLanguage: lng,
			}),
			Registration.instance(IPushService, {}),
			Registration.instance(INotificationManager, { permission: 'default' }),
			Registration.instance(IPwaInstallService, {
				canShowInstallOption: false,
			}),
			Registration.instance(IRouter, router),
			CheckoutRoute,
		],
	).started
	const host = fixture.appHost.querySelector('checkout-route') as Element
	const vm = CustomElement.for<CheckoutRoute>(host).viewModel
	vm.loading({ id: EVENT_ID })
	await vi.waitFor(() => expect(vm.step).not.toBe('loading'))
	await tasksSettled()
	return { fixture, vm, checkoutClient, router }
}

const byTestId = (host: HTMLElement, id: string) =>
	host.querySelector<HTMLElement>(`[data-testid="${id}"]`)

describe('CheckoutRoute verified sale (fixture)', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	it('says the sale requires マイナンバーカード verification and offers to verify, without starting a checkout', async () => {
		// @spec components/infrastructure/fan/web/route/checkout "Unverified fan on a verified sale"
		const { fixture, vm, checkoutClient, router } = await render(
			'ja',
			undefined,
		)
		const host = fixture.appHost

		expect(vm.step).toBe('verify-required')
		expect(byTestId(host, 'checkout-count')).toBeNull()
		expect(byTestId(host, 'checkout-hold')).toBeNull()
		expect(byTestId(host, 'checkout-verify-body')?.textContent).toContain(
			'マイナンバーカードで本人確認を済ませた方のみ',
		)
		const action = byTestId(host, 'checkout-verify-action')
		expect(action?.textContent).toBe('本人確認を行う')

		action?.click()
		expect(router.load).toHaveBeenCalledWith('/settings')
		expect(checkoutClient.start).not.toHaveBeenCalled()
		await fixture.stop(true)
	})

	it('says the requirement in English too', async () => {
		const { fixture } = await render('en', undefined)

		expect(
			byTestId(fixture.appHost, 'checkout-verify-body')?.textContent,
		).toContain('My Number Card')
		await fixture.stop(true)
	})

	it('starts the checkout as usual for a fan with an Active JPKI IdentityVerification', async () => {
		// @spec components/infrastructure/fan/web/route/checkout "Verified fan on a verified sale"
		const { fixture, vm, checkoutClient } = await render('ja', activeJpki)
		const host = fixture.appHost

		expect(vm.step).toBe('count')
		expect(byTestId(host, 'checkout-verify')).toBeNull()
		// The requirement is still stated before the fan starts.
		expect(byTestId(host, 'checkout-verify-note')?.textContent).toContain(
			'マイナンバーカードで本人確認を済ませた方のみ',
		)

		byTestId(host, 'checkout-hold')?.click()
		await vi.waitFor(() => expect(vm.step).toBe('personal-details'))

		expect(checkoutClient.start).toHaveBeenCalledWith(
			'type-1',
			1,
			expect.anything(),
		)
		await fixture.stop(true)
	})
})
