import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { EventSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { SeriesSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { IConcertRpcClient } from '../../src/adapter/rpc/client/concert-client'
import { ILotteryEntryRpcClient } from '../../src/adapter/rpc/client/lottery-entry-client'
import { ITicketSaleRpcClient } from '../../src/adapter/rpc/client/ticket-sale-client'
import type { TicketSale } from '../../src/entities/ticket-sale'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { LotteryApplyRoute } from '../../src/routes/lottery-apply/lottery-apply-route'
import { IKycService } from '../../src/services/kyc-service'
import { IStripeService } from '../../src/services/stripe-service'
import { IUserStore } from '../../src/services/user-store'

const EVENT_ID = 'event-1'
const TYPE_ID = 'type-1'

/** The ファンクラブ先行 lottery of the 3 November event, 8000 yen, limit 4. */
const presale: TicketSale = {
	id: 'sale-1',
	name: 'ファンクラブ先行',
	method: 'lottery',
	saleStart: new Date(Date.now() - 60 * 60 * 1000),
	saleEnd: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
	verificationRequirement: 'none',
	ticketType: {
		id: TYPE_ID,
		eventId: EVENT_ID,
		price: 8000,
		perAccountLimit: 4,
		state: 'ended',
		lowStock: false,
	},
}

const concert = {
	event: create(EventSchema, {
		id: { value: EVENT_ID },
		localDate: { value: { year: 2026, month: 11, day: 3 } },
		listedVenueName: { value: 'Zepp Haneda' },
		seriesId: { value: 's1' },
	}),
	series: create(SeriesSchema, {
		id: { value: 's1' },
		title: { value: 'ONE MAN LIVE' },
	}),
	artists: [],
}

/**
 * Renders the real lottery entry template with the real translation bundles
 * and the route loaded for the presale TicketType.
 */
async function render(lng: 'ja' | 'en', user?: Record<string, string>) {
	const fixture = await createFixture(
		'<lottery-apply-route></lottery-apply-route>',
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
				listByEvent: vi.fn().mockResolvedValue([presale]),
			}),
			Registration.instance(ILotteryEntryRpcClient, {}),
			Registration.instance(IStripeService, { isConfigured: true }),
			Registration.instance(IKycService, {}),
			Registration.instance(IUserStore, {
				current: user,
				currentLanguage: lng,
			}),
			Registration.instance(IRouter, { load: vi.fn() }),
			LotteryApplyRoute,
		],
	).started
	const host = fixture.appHost.querySelector('lottery-apply-route') as Element
	const vm = CustomElement.for<LotteryApplyRoute>(host).viewModel
	vm.loading({ id: EVENT_ID, ticketTypeId: TYPE_ID })
	await vi.waitFor(() => expect(vm.step).toBe('count'))
	await tasksSettled()
	return { fixture, vm }
}

const byTestId = (host: HTMLElement, id: string) =>
	host.querySelector(`[data-testid="${id}"]`)
const phoneError = (host: HTMLElement) =>
	host.querySelector('#lottery-apply-phone-error')
const phoneInput = (host: HTMLElement) =>
	host.querySelector('input[type="tel"]') as HTMLInputElement

describe('LotteryApplyRoute ticket type (fixture)', () => {
	it('shows the sale name, the event, the price and offers 1 to 4 tickets', async () => {
		// @spec components/infrastructure/fan/web/route/lottery-apply "Presale entry"
		const { fixture } = await render('ja')
		const host = fixture.appHost

		expect(byTestId(host, 'lottery-apply-sale-name')?.textContent).toBe(
			'ファンクラブ先行',
		)
		expect(byTestId(host, 'lottery-apply-event')?.textContent).toContain(
			'2026年11月3日',
		)
		expect(byTestId(host, 'lottery-apply-price')?.textContent).toBe(
			'1枚 8,000円（税込）',
		)
		const options = [
			...host.querySelectorAll<HTMLOptionElement>(
				'[data-testid="lottery-apply-count-select"] option',
			),
		].map((o) => o.textContent)
		expect(options).toEqual(['1', '2', '3', '4'])
		await fixture.stop(true)
	})
})

describe('LotteryApplyRoute saved details (fixture)', () => {
	it("shows the fan's saved name and phone number in the fields", async () => {
		// @spec components/infrastructure/fan/web/route/lottery-apply "Returning fan"
		const { fixture, vm } = await render('ja', {
			id: 'u1',
			fullName: '山田 花子',
			phoneNumber: '+819012345678',
		})
		vm.step = 'identity'
		await tasksSettled()
		const host = fixture.appHost

		const name = byTestId(host, 'lottery-apply-name') as HTMLInputElement
		expect(name.value).toBe('山田 花子')
		expect(phoneInput(host).value).toBe('090-1234-5678')
		expect(host.textContent).toContain(ja.lotteryApply.identity.note)
		await fixture.stop(true)
	})

	it('leaves both fields empty for a first entry', async () => {
		// @spec components/infrastructure/fan/web/route/lottery-apply "First entry"
		const { fixture, vm } = await render('ja', { id: 'u1' })
		vm.step = 'identity'
		await tasksSettled()
		const host = fixture.appHost

		const name = byTestId(host, 'lottery-apply-name') as HTMLInputElement
		expect(name.value).toBe('')
		expect(phoneInput(host).value).toBe('')
		await fixture.stop(true)
	})
})

describe('LotteryApplyRoute phone field (fixture)', () => {
	// @spec components/infrastructure/fan/web/route/lottery-apply "Number fits neither form"
	it.each([
		['ja', ja.lotteryApply.phoneInvalid],
		['en', en.lotteryApply.phoneInvalid],
	] as const)(
		'shows the %s invalid-number message and disables continue',
		async (lng, message) => {
			const { fixture, vm } = await render(lng)
			vm.step = 'identity'
			vm.fullName = '山田太郎'
			vm.phoneNumber = '12345'
			await tasksSettled()

			const host = fixture.appHost
			expect(phoneError(host)?.textContent).toBe(message)
			expect(phoneInput(host).getAttribute('aria-invalid')).toBe('true')
			expect(phoneInput(host).getAttribute('aria-describedby')).toBe(
				'lottery-apply-phone-error',
			)
			const proceed = byTestId(
				host,
				'lottery-apply-to-payment',
			) as HTMLButtonElement
			expect(proceed.disabled).toBe(true)
			await fixture.stop(true)
		},
	)

	it('hides the message for an empty or convertible number', async () => {
		const { fixture, vm } = await render('ja')
		vm.step = 'identity'
		await tasksSettled()
		const host = fixture.appHost
		expect(phoneError(host)).toBeNull()

		vm.phoneNumber = '090-1234-5678'
		await tasksSettled()

		expect(phoneError(host)).toBeNull()
		expect(phoneInput(host).getAttribute('aria-invalid')).toBe('false')
		await fixture.stop(true)
	})
})
