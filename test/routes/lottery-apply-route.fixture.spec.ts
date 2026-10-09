import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { ILotteryRpcClient } from '../../src/adapter/rpc/client/lottery-client'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { LotteryApplyRoute } from '../../src/routes/lottery-apply/lottery-apply-route'
import { IIdentityVerificationService } from '../../src/services/identity-verification-service'
import { IStripeService } from '../../src/services/stripe-service'

/**
 * Renders the real lottery-apply template with the real translation bundles
 * to check the invalid-phone message (a `t` binding the view-model spec
 * cannot see) in both locales.
 */
async function render(lng: 'ja' | 'en') {
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
			Registration.instance(ILotteryRpcClient, {}),
			Registration.instance(IStripeService, { isConfigured: true }),
			Registration.instance(IIdentityVerificationService, {}),
			Registration.instance(IRouter, { load: vi.fn() }),
			LotteryApplyRoute,
		],
	).started
	const host = fixture.appHost.querySelector('lottery-apply-route') as Element
	const vm = CustomElement.for<LotteryApplyRoute>(host).viewModel
	vm.step = 'identity'
	vm.fullName = '山田太郎'
	await tasksSettled()
	return { fixture, vm }
}

const phoneError = (host: HTMLElement) =>
	host.querySelector('#lottery-apply-phone-error')
const phoneInput = (host: HTMLElement) =>
	host.querySelector('input[type="tel"]') as HTMLInputElement

describe('LotteryApplyRoute phone field (fixture)', () => {
	// @spec components/infrastructure/fan/web/route/lottery-apply "Number fits neither form"
	it.each([
		['ja', ja.lotteryApply.phoneInvalid],
		['en', en.lotteryApply.phoneInvalid],
	] as const)(
		'shows the %s invalid-number message and disables continue',
		async (lng, message) => {
			const { fixture, vm } = await render(lng)

			vm.phoneNumber = '12345'
			await tasksSettled()

			const host = fixture.appHost
			expect(phoneError(host)?.textContent).toBe(message)
			expect(phoneInput(host).getAttribute('aria-invalid')).toBe('true')
			expect(phoneInput(host).getAttribute('aria-describedby')).toBe(
				'lottery-apply-phone-error',
			)
			const proceed = host.querySelector(
				'.lottery-apply-actions .lottery-apply-btn-primary',
			) as HTMLButtonElement
			expect(proceed.disabled).toBe(true)
			await fixture.stop(true)
		},
	)

	it('hides the message for an empty or convertible number', async () => {
		const { fixture, vm } = await render('ja')
		const host = fixture.appHost
		expect(phoneError(host)).toBeNull()

		vm.phoneNumber = '090-1234-5678'
		await tasksSettled()

		expect(phoneError(host)).toBeNull()
		expect(phoneInput(host).getAttribute('aria-invalid')).toBe('false')
		await fixture.stop(true)
	})
})
