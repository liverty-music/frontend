import { expect, type Frame, type Locator, type Page } from '@playwright/test'
import type { SaleStock } from './sale'

/**
 * Checkout steps shared by the production purchase specs. They drive the
 * checkout screen the Event page's buy action opens for one seat type.
 */

/** The Event page's row of the stock's seat type in the ticket section. */
export function stockRow(page: Page, stock: SaleStock): Locator {
	return page.getByTestId('event-stock').filter({
		has: page
			.getByTestId('event-stock-name')
			.getByText(stock.seatTypeName, { exact: true }),
	})
}

/**
 * Open the checkout of the stock from the Event page's action to buy on its
 * seat type's row. `query` is added to the Event page's address (e.g.
 * `?ref=…`).
 */
export async function openCheckout(
	page: Page,
	eventId: string,
	stock: SaleStock,
	query = '',
): Promise<void> {
	await page.goto(`/events/${eventId}${query}`)
	await stockRow(page, stock).getByTestId('event-buy').click()
	await expect(page).toHaveURL(
		new RegExp(`/events/${eventId}/checkout/${stock.id}$`),
	)
	await expect(page.getByTestId('checkout-count')).toBeVisible()
	await expect(page.getByTestId('checkout-seat-type')).toHaveText(
		stock.seatTypeName,
	)
}

/** Stripe's test card that authorizes without 3D Secure. */
const TEST_CARD = { number: '4242424242424242', expiry: '12 / 34', cvc: '123' }

export async function holdTickets(page: Page, count: number): Promise<void> {
	await page.getByTestId('checkout-count-select').selectOption(String(count))
	await page.getByTestId('checkout-hold').click()
	await expect(page.getByTestId('checkout-personal-details')).toBeVisible()
	await expect(page.getByTestId('checkout-countdown')).toBeVisible()
}

/** Keep the prefilled personal details, or fill it in on the first checkout. */
export async function fillPersonalDetails(page: Page): Promise<void> {
	const name = page.getByTestId('checkout-name')
	if (!(await name.inputValue())) await name.fill('テスト 太郎')
	const phone = page.getByTestId('checkout-phone')
	if (!(await phone.inputValue())) await phone.fill('090-0000-0000')
	await page.getByTestId('checkout-to-payment').click()
	// Stripe.js loads on the first card step, which can take a while.
	await expect(page.getByTestId('checkout-payment')).toBeVisible({
		timeout: 60_000,
	})
}

/** Enter Stripe's test card in the Payment Element and authorize it. */
export async function authorizeCard(page: Page): Promise<void> {
	const card = await cardFrame(page)
	await card.locator('input[name="number"]').fill(TEST_CARD.number)
	await card.locator('input[name="expiry"]').fill(TEST_CARD.expiry)
	await card.locator('input[name="cvc"]').fill(TEST_CARD.cvc)
	await page.getByTestId('checkout-authorize-card').click()
	await expect(page.getByTestId('checkout-confirm')).toBeVisible({
		timeout: 60_000,
	})
}

/**
 * The Payment Element's card frame. Its title is localized, so it is found
 * by the card number input it holds. On a phone the element opens on tabs
 * (card, Google Pay), and the card fields appear once the card tab is chosen.
 */
async function cardFrame(page: Page): Promise<Frame> {
	let found: Frame | undefined
	await expect
		.poll(
			async () => {
				for (const frame of page.frames()) {
					if ((await frame.locator('input[name="number"]').count()) > 0) {
						found = frame
						return true
					}
					const cardTab = frame.getByRole('button', {
						name: /^(カード|Card)$/,
					})
					if (await cardTab.isVisible().catch(() => false)) {
						await cardTab.click()
					}
				}
				return false
			},
			{ timeout: 30_000 },
		)
		.toBe(true)
	if (!found) throw new Error('the card frame did not load')
	return found
}
