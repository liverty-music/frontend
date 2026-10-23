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
import { IAppConfig } from '../../src/config/app-config'
import type { Checkout } from '../../src/entities/checkout'
import type { IdentityVerification } from '../../src/entities/identity-verification'
import type { TicketSale } from '../../src/entities/ticket-sale'
import { IAnalyticsService } from '../../src/lib/analytics/analytics-service'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { CheckoutRoute } from '../../src/routes/checkout/checkout-route'
import { IErrorBoundaryService } from '../../src/services/error-boundary-service'
import { IIdentityVerificationService } from '../../src/services/identity-verification-service'
import { INotificationManager } from '../../src/services/notification-manager'
import { IPushService } from '../../src/services/push-service'
import { IPwaInstallService } from '../../src/services/pwa-install-service'
import {
	IStripeService,
	StripeService,
} from '../../src/services/stripe-service'
import { IUserStore } from '../../src/services/user-store'
import { createMockAnalytics } from '../helpers/mock-analytics'
import { createMockErrorBoundary } from '../helpers/mock-error-boundary'

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
	options: {
		sale?: TicketSale
		stripe?: Parameters<typeof Registration.instance>[1]
		extra?: unknown[]
	} = {},
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
			// Key actions add a step for the error report.
			Registration.instance(IErrorBoundaryService, createMockErrorBoundary()),
			Registration.instance(IAnalyticsService, createMockAnalytics()),
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
				listByEvent: vi.fn().mockResolvedValue([options.sale ?? jpkiOnlySale]),
			}),
			Registration.instance(ICheckoutRpcClient, checkoutClient),
			options.stripe ??
				Registration.instance(IStripeService, { isConfigured: true }),
			...(options.extra ?? []),
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
			undefined,
			expect.anything(),
		)
		await fixture.stop(true)
	})
})

const ERROR_MESSAGES_SPEC =
	'components/infrastructure/fan/web/global/error-messages'

/** The same sale, open to every fan. */
const openSale: TicketSale = {
	...jpkiOnlySale,
	verificationRequirement: 'none',
}

/**
 * The real StripeService over a fake Stripe.js: the card form and the payment
 * confirmation answer what the test gives, as the Payment Element would.
 */
function stripeWith(answers: {
	submit?: () => Promise<unknown>
	confirmPayment?: () => Promise<unknown>
}) {
	const elements = {
		submit: vi.fn(answers.submit ?? (async () => ({}))),
		create: vi.fn(() => ({ mount: vi.fn(), destroy: vi.fn() })),
	}
	const stripe = {
		elements: vi.fn(() => elements),
		createConfirmationToken: vi.fn(async () => ({
			confirmationToken: {
				id: 'ctoken_1',
				payment_method_preview: { card: { brand: 'visa', last4: '4242' } },
			},
		})),
		confirmPayment: vi.fn(
			answers.confirmPayment ??
				(async () => ({
					paymentIntent: { id: 'pi_1', status: 'requires_capture' },
				})),
		),
	}
	class FakeStripeService extends StripeService {
		public override async getStripe() {
			return stripe as never
		}
	}
	return Registration.singleton(IStripeService, FakeStripeService)
}

/** Opens the card step of an open sale and continues with the card entered. */
async function continueWithCard(stripe: ReturnType<typeof stripeWith>) {
	const rendered = await render('ja', undefined, {
		sale: openSale,
		stripe,
		extra: [
			Registration.instance(IAppConfig, { stripePublishableKey: 'pk_test_x' }),
		],
	})
	const { fixture, vm, checkoutClient } = rendered
	checkoutClient.authorizeCard.mockResolvedValue('cs_1')
	await vm.hold()
	vm.fullName = '山田 花子'
	vm.phoneNumber = '090-1234-5678'
	await vm.toPayment()
	await tasksSettled()
	expect(vm.step).toBe('payment')
	byTestId(fixture.appHost, 'checkout-authorize-card')?.click()
	await vi.waitFor(() => expect(vm.busy).toBe(false))
	await tasksSettled()
	return rendered
}

describe('CheckoutRoute card failures (fixture)', () => {
	it(`@spec ${ERROR_MESSAGES_SPEC} "Card declined at checkout"`, async () => {
		const { fixture, vm } = await continueWithCard(
			stripeWith({
				confirmPayment: async () => ({
					error: {
						type: 'card_error',
						code: 'card_declined',
						decline_code: 'insufficient_funds',
						message: 'Your card has insufficient funds.',
					},
				}),
			}),
		)
		const host = fixture.appHost

		expect(vm.step).toBe('payment')
		const error = byTestId(host, 'checkout-card-error')?.textContent ?? ''
		expect(error.replace(/\s+/g, ' ').trim()).toBe(
			`カードを利用できませんでした。 ${ja.checkout.payment.tryAnother}`,
		)
		expect(host.textContent).not.toContain('insufficient funds')
		await fixture.stop(true)
	})

	it(`@spec ${ERROR_MESSAGES_SPEC} "Card details incomplete"`, async () => {
		const { fixture, vm, checkoutClient } = await continueWithCard(
			stripeWith({
				submit: async () => ({
					error: {
						type: 'validation_error',
						code: 'incomplete_number',
						message: 'Your card number is incomplete.',
					},
				}),
			}),
		)
		const host = fixture.appHost

		expect(vm.step).toBe('payment')
		expect(byTestId(host, 'checkout-card-error')?.textContent).toContain(
			'カード情報を確認してください。',
		)
		expect(host.textContent).not.toContain('Your card number is incomplete')
		// Nothing is authorized for a card the form refused.
		expect(checkoutClient.authorizeCard).not.toHaveBeenCalled()
		await fixture.stop(true)
	})
})
