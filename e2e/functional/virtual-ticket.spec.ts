import { expect, test } from '../support/test'
import {
	faceLayout,
	mockBackend,
	REAL_COVER,
	sharedPixels,
} from '../support/virtual-ticket-backend'

// The first page load compiles the app on the dev server; allow for it, and
// for one 5 s admission poll.
test.describe.configure({ timeout: 90_000 })
// No service worker: in WebKit, requests the worker makes are not routed
// through `page.route`, so a production build's worker would bypass the mocks.
// The dev server, where CI runs this, registers none anyway.
test.use({
	locale: 'ja-JP',
	viewport: { width: 390, height: 844 },
	serviceWorkers: 'block',
})

/**
 * The virtual ticket against a mocked backend, run in Chromium (`functional`)
 * and WebKit (`webkit-virtual-ticket`): a fan opens a ticket, shows the code,
 * both tickets are admitted on the next poll, the code closes and the stamp
 * is pressed; reopened, the stamp is at rest; the fan turns the ticket over
 * for the eligible person's details, shares the image of the front, which is
 * checked pixel by pixel, and picks a design, which the device keeps.
 *
 * The cover is served by the test with the CDN's CORS header. Set
 * `E2E_REAL_COVER` to a production cover URL to load that one from the CDN
 * instead (the check that the CDN's header lets the front and the share image
 * use a real cover).
 */

test('a fan opens a ticket, is admitted while showing the code, sees the stamp pressed once, turns the ticket over, shares the image of its front and picks a design', async ({
	page,
}) => {
	// @spec components/infrastructure/fan/web/route/tickets "Fan taps a ticket"
	// @spec components/infrastructure/fan/web/route/tickets "Admitted while the code is shown"
	// @spec components/infrastructure/fan/web/route/tickets "Opened again"
	// @spec components/infrastructure/fan/web/route/tickets "Sharing from a phone"
	// @spec components/infrastructure/fan/web/route/tickets "Shared after entry"
	// @spec components/infrastructure/fan/web/route/tickets "Fan turns the ticket over"
	// @spec components/infrastructure/fan/web/route/tickets "Fan picks a design"
	// @spec components/infrastructure/fan/web/route/tickets "Design kept on the device"
	// WebKit (`webkit-virtual-ticket`) stands in for Safari on an iPhone, which
	// the owner does not have; Chromium (`functional`) stands in for Chrome on
	// Android, which the owner checks on a real phone after release.
	// @spec components/infrastructure/fan/web/route/tickets "iPhone"
	// @spec components/infrastructure/fan/web/route/tickets "Virtual ticket on an iPhone"
	// @spec components/infrastructure/fan/web/route/tickets "Virtual ticket on an Android phone"
	// This flow runs without WebGL: the front shows the plain cover, and the
	// share image is made the same way. Software WebGL would slow every step
	// of it; virtual-ticket-webgl.spec.ts covers the drawn art.
	await page.addInitScript(() => {
		const getContext = HTMLCanvasElement.prototype.getContext
		HTMLCanvasElement.prototype.getContext = function (
			this: HTMLCanvasElement,
			type: string,
			...rest: unknown[]
		) {
			if (type.startsWith('webgl')) return null
			return (getContext as (...args: unknown[]) => unknown).call(
				this,
				type,
				...rest,
			)
		} as typeof getContext
	})
	const backend = await mockBackend(page)
	await page.goto('/tickets')
	const cards = page.getByTestId('tickets-card')
	await expect(cards).toHaveCount(2, { timeout: 30_000 })

	// The list offers the code as before the virtual ticket ("iPhone").
	await page
		.locator('.tickets-event')
		.getByRole('button', { name: '入場用QRコードを表示' })
		.click()
	await expect(page.locator('.tickets-code-image')).toBeVisible({
		timeout: 15_000,
	})
	await page
		.locator('.tickets-code')
		.getByRole('button', { name: '閉じる' })
		.click()
	await expect(page.locator('.tickets-code-image')).toHaveCount(0)

	// Tap the first ticket: its virtual ticket opens with the cover.
	await cards.first().locator('dl').click()
	const sheet = page.getByTestId('tickets-virtual')
	const face = sheet.locator('.virtual-ticket')
	await expect(face).toContainText('Autumn Tour 2026')
	await expect(face).toContainText('東京都')
	await expect(face).toContainText('S席')
	// The front holds no personal details.
	await expect(face).not.toContainText('山田 花子')
	await expect(face).not.toContainText('090-1234-5678')
	const cover = face.locator('.ticket-front-cover-image')
	await expect
		.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth))
		.toBeGreaterThan(0)
	await expect(face.getByTestId('virtual-ticket-stamp')).toHaveCount(0)

	// Show the code from the virtual ticket; both tickets are admitted.
	await page.getByTestId('tickets-virtual-code').click()
	await expect(page.locator('.tickets-code-image')).toBeVisible({
		timeout: 15_000,
	})
	backend.admit()

	// On the next poll the code closes and the stamp is pressed.
	const stamp = face.getByTestId('virtual-ticket-stamp')
	await expect(stamp).toHaveAttribute('data-stamp', 'press', {
		timeout: 15_000,
	})
	await expect(page.locator('.tickets-code-image')).toHaveCount(0)
	await expect(stamp).toContainText('入場済')
	await stamp.evaluate((el) =>
		Promise.all(el.getAnimations().map((a) => a.finished)),
	)

	// Closed and reopened, the stamp is at rest.
	await sheet.getByRole('button', { name: '閉じる' }).click()
	await expect(sheet).toHaveCount(0)
	await page.getByTestId('tickets-open-virtual').first().click()
	await expect(stamp).toHaveAttribute('data-stamp', 'rest')
	await expect(face).toContainText('S席')

	// Turned over, the back names the eligible person and carries the two
	// statements; the front cannot be reached meanwhile.
	const card = sheet.locator('.virtual-ticket-card')
	const back = sheet.getByTestId('virtual-ticket-back')
	const flip = sheet.getByTestId('virtual-ticket-flip')
	await flip.click()
	await expect(card).toHaveAttribute('data-side', 'back')
	await expect(back.getByTestId('virtual-ticket-full-name')).toHaveText(
		'山田 花子',
	)
	await expect(back.getByTestId('virtual-ticket-phone-number')).toHaveText(
		'090-1234-5678',
	)
	await expect(back).toContainText('無断有償譲渡禁止')
	await expect(back).toContainText('入場資格者の氏名・連絡先確認済み')
	await expect(face).toHaveAttribute('inert', '')
	await flip.click()
	await expect(card).toHaveAttribute('data-side', 'front')

	// Share: the image is the front, with the cover in its art and no stamp.
	const layout = await faceLayout(face, [
		'.ticket-front-cover',
		'admission-stamp',
	])
	await page.getByTestId('tickets-virtual-share').click()
	// The image embeds the faces it is set in, which it fetches first.
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						!!(navigator as Navigator & { __sharedFile?: File }).__sharedFile,
				),
			{ timeout: 30_000 },
		)
		.toBe(true)
	await expect(page.locator('.tickets-error')).toHaveCount(0)
	const shot = await sharedPixels(page, layout.width, layout.rects)
	await test.info().attach('share-image.png', {
		body: Buffer.from(shot.dataUrl.split(',')[1], 'base64'),
		contentType: 'image/png',
	})
	expect(shot.type).toBe('image/png')
	expect(shot.name).toBe('liverty-ticket.png')
	expect(shot.width).toBeGreaterThanOrEqual(Math.round(layout.width * 2))
	// The image is the face's shape, whatever the cover's shape.
	expect(shot.height / shot.width).toBeCloseTo(layout.height / layout.width, 2)
	const [coverPx, stampPx] = shot.grids

	// The cover is drawn into the art (the test cover is one green). The art
	// is darkened towards its foot and, with WebGL, foiled, so the samples
	// are checked for the cover's hue, not for its exact colour.
	if (!REAL_COVER) {
		const green = coverPx.filter(([r, g, b]) => g > r && g > b)
		expect(green.length).toBeGreaterThanOrEqual(10)
	} else {
		// A real cover: at least not one flat field.
		const distinct = new Set(coverPx.map((p) => p.join()))
		expect(distinct.size).toBeGreaterThan(1)
	}
	// No stamp ink where the stamp sits on the face.
	for (const [r, g] of stampPx) expect(r - g).toBeLessThan(60)

	// The ticket on screen is unchanged by the share.
	await expect(face).not.toHaveAttribute('data-share')
	await expect(stamp).toBeVisible()

	// The fan picks a design; closed and reopened, the ticket keeps it.
	await expect(card).toHaveAttribute('data-preset', 'default')
	await sheet
		.locator('[data-testid="virtual-ticket-preset"][data-preset="rock"]')
		.click()
	await expect(card).toHaveAttribute('data-preset', 'rock')
	await expect(card).toHaveAttribute('data-side', 'front')
	await sheet.getByRole('button', { name: '閉じる' }).click()
	await expect(sheet).toHaveCount(0)
	await page.getByTestId('tickets-open-virtual').first().click()
	await expect(card).toHaveAttribute('data-preset', 'rock')
})
