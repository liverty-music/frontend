import type { Page } from './test'

/**
 * A stand-in for Stripe.js, so a card authorization flow runs without the
 * payment provider: `/config.json` gains a test publishable key, and the
 * Stripe.js script defines a `Stripe` whose Payment Element renders a
 * placeholder, whose card form reads as a VISA ending 4242 (`submit`,
 * `createConfirmationToken`, as the first-come checkout reads it) and whose
 * `confirmPayment` authorizes the card at once (`requires_capture`). Each Elements group's client secret is recorded on
 * `window.__stripeStub.clientSecrets`, in order. No traffic leaves the machine.
 */
export async function stubStripe(page: Page): Promise<void> {
	await page.route('**/config.json', async (route) => {
		const response = await route.fetch()
		const config = (await response.json()) as Record<string, unknown>
		await route.fulfill({
			response,
			json: { ...config, stripePublishableKey: 'pk_test_e2e' },
		})
	})
	await page.route('https://js.stripe.com/**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/javascript',
			body: STRIPE_JS,
		}),
	)
}

/** The client secrets the page created Elements groups with, in order. */
export async function stripeClientSecrets(page: Page): Promise<string[]> {
	return page.evaluate(
		() =>
			(window as unknown as { __stripeStub?: { clientSecrets: string[] } })
				.__stripeStub?.clientSecrets ?? [],
	)
}

const STRIPE_JS = `
(() => {
	const stub = { clientSecrets: [] }
	window.__stripeStub = stub
	function Stripe() {
		let clientSecret = ''
		return {
			elements(options) {
				clientSecret = (options && options.clientSecret) || ''
				stub.clientSecrets.push(clientSecret)
				return {
					async submit() {
						return {}
					},
					create() {
						let host = null
						return {
							mount(el) {
								host = el
								const card = document.createElement('p')
								card.textContent = 'Card form (stub)'
								card.dataset.testid = 'stripe-stub-card'
								el.appendChild(card)
							},
							destroy() {
								if (host) host.textContent = ''
							},
						}
					},
				}
			},
			async createConfirmationToken() {
				return {
					confirmationToken: {
						id: 'ctoken_e2e',
						payment_method_preview: {
							card: { brand: 'visa', last4: '4242' },
						},
					},
				}
			},
			async confirmPayment(options) {
				const secret = (options && options.clientSecret) || clientSecret
				return {
					paymentIntent: {
						id: secret.split('_secret_')[0],
						status: 'requires_capture',
					},
				}
			},
		}
	}
	Stripe.version = 'endive'
	window.Stripe = Stripe
})()
`
