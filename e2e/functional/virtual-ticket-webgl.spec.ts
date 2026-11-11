import { expect, test } from '../support/test'
import {
	faceLayout,
	mockBackend,
	REAL_COVER,
	sharedPixels,
} from '../support/virtual-ticket-backend'

// Software WebGL is slow, and the first page load compiles the app on the
// dev server.
test.describe.configure({ timeout: 120_000 })
// Chromium draws WebGL in software here, so the art's renderer starts as it
// does on a phone. In its own file because launch options start a new
// browser, and kept short. The whole flow, without WebGL, is
// virtual-ticket.spec.ts.
test.use({
	locale: 'ja-JP',
	viewport: { width: 390, height: 844 },
	serviceWorkers: 'block',
	launchOptions: {
		args: [
			'--use-gl=swiftshader',
			'--enable-unsafe-swiftshader',
			'--ignore-gpu-blocklist',
		],
	},
})

test('the art is drawn under the page’s Content-Security-Policy and the ticket follows the device’s tilt', async ({
	page,
}) => {
	await mockBackend(page)
	await page.goto('/tickets')
	const cards = page.getByTestId('tickets-card')
	await expect(cards).toHaveCount(2, { timeout: 30_000 })
	await cards.first().locator('dl').click()
	const sheet = page.getByTestId('tickets-virtual')
	const face = sheet.locator('.virtual-ticket')
	await expect(face).toContainText('Autumn Tour 2026')

	// The policy allows no eval. A renderer that cannot start falls back
	// to the plain cover without an error, so the fallback must not pass
	// for the drawn art.
	expect(
		await page.evaluate(
			() => !!document.createElement('canvas').getContext('webgl2'),
		),
	).toBe(true)
	await expect(face).toHaveAttribute('data-drawn', 'true', {
		timeout: 30_000,
	})

	// Tilting the device tilts the ticket, as in Chrome on Android, which
	// gives the orientation without asking. Sent until the test ends: the
	// ticket eases towards the pose, and sways by itself again without input.
	await page.evaluate(() => {
		setInterval(
			() =>
				dispatchEvent(
					new DeviceOrientationEvent('deviceorientation', {
						alpha: 0,
						beta: 45,
						gamma: 30,
					}),
				),
			50,
		)
	})
	await expect
		.poll(
			() =>
				sheet
					.locator('.virtual-ticket-card')
					.evaluate((el: HTMLElement) =>
						Number(el.style.getPropertyValue('--tilt-x')),
					),
			{ timeout: 30_000 },
		)
		.toBeGreaterThan(0.6)

	// The share image takes its art from a second renderer, under the same
	// policy: the cover's hue is in the art, graded and foiled.
	const layout = await faceLayout(face, ['.ticket-front-cover'])
	await page.getByTestId('tickets-virtual-share').click()
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
	const shot = await sharedPixels(page, layout.width, layout.rects)
	await test.info().attach('share-image-webgl.png', {
		body: Buffer.from(shot.dataUrl.split(',')[1], 'base64'),
		contentType: 'image/png',
	})
	expect(shot.type).toBe('image/png')
	if (!REAL_COVER) {
		const green = shot.grids[0].filter(([r, g, b]) => g > r && g > b)
		expect(green.length).toBeGreaterThanOrEqual(10)
	}
})
