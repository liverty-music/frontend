import { deflateSync } from 'node:zlib'
import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { connectError, FAN_SUB, mockFanRpc } from '../support/fan-auth'
import { seedSignedInFan } from '../support/fan-shell'
import { expect, type Locator, type Page, test } from '../support/test'

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

const EVENT_ID = fakeId('virtual-ticket-event')
const ORDER_ID = fakeId('virtual-ticket-order')
const STOCK_ID = fakeId('virtual-ticket-stock')
const SEAT_TYPE_ID = fakeId('virtual-ticket-seat-type')
const TICKETS = [1, 2].map((i) => fakeId(`virtual-ticket-ticket-${i}`))
const REAL_COVER = process.env.E2E_REAL_COVER ?? ''
const COVER_URL =
	REAL_COVER ||
	'https://cdn.liverty-music.app/cdn/e2e/virtual-ticket/large.webp'
/** The test cover's one colour: a green no other part of the face uses. */
const COVER_RGB: readonly [number, number, number] = [20, 160, 90]
const DAY = 24 * 60 * 60 * 1000

/** A PNG of one colour, so any pixel of the cover's area can be checked. */
function solidPng(width: number, height: number, [r, g, b]: readonly number[]) {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		return c >>> 0
	})
	const crc = (buf: Buffer) => {
		let c = 0xffffffff
		for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
		return (c ^ 0xffffffff) >>> 0
	}
	const chunk = (type: string, data: Buffer) => {
		const len = Buffer.alloc(4)
		len.writeUInt32BE(data.length)
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
		const sum = Buffer.alloc(4)
		sum.writeUInt32BE(crc(body))
		return Buffer.concat([len, body, sum])
	}
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header.set([8, 2, 0, 0, 0], 8)
	const row = Buffer.alloc(1 + width * 3)
	for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3)
	const raw = Buffer.concat(Array.from({ length: height }, () => row))
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	])
}

function concert() {
	const d = new Date(Date.now() + 10 * DAY)
	const at = (h: number, m: number) =>
		new Date(
			Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), h - 9, m),
		).toISOString()
	return {
		id: { value: EVENT_ID },
		performers: [
			{
				id: { value: fakeId('virtual-ticket-artist') },
				name: { value: 'The Band' },
			},
		],
		series: {
			id: { value: fakeId('virtual-ticket-series') },
			title: { value: 'Autumn Tour 2026' },
			publishState: 'PUBLISH_STATE_PUBLISHED',
			coverImage: { large: { value: COVER_URL } },
		},
		localDate: {
			value: {
				year: d.getFullYear(),
				month: d.getMonth() + 1,
				day: d.getDate(),
			},
		},
		openTime: { value: at(17, 30) },
		startTime: { value: at(18, 30) },
		listedVenueName: { value: 'Shibuya WWW' },
		venue: { adminArea: { value: 'JP-13' } },
	}
}

function ticketWire(id: string, admitTime?: string) {
	return {
		id: { value: id },
		orderId: { value: ORDER_ID },
		userId: { value: FAN_SUB },
		eventId: { value: EVENT_ID },
		resaleWithoutConsentProhibited: true,
		status: 'TICKET_STATUS_ISSUED',
		issueTime: new Date(Date.now() - DAY).toISOString(),
		...(admitTime ? { admitTime } : {}),
	}
}

/** Mock the backend; the tickets turn 入場済み once `admit()` is called. */
async function mockBackend(page: Page) {
	let admittedAt = ''
	await seedSignedInFan(page, { language: 'ja' })
	// The share sheet: keep the file the app hands over.
	await page.addInitScript(() => {
		const nav = navigator as Navigator & { __sharedFile?: File }
		Object.defineProperty(navigator, 'canShare', {
			configurable: true,
			value: (data: ShareData) => (data.files?.length ?? 0) > 0,
		})
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: async (data: ShareData) => {
				nav.__sharedFile = data.files?.[0]
			},
		})
	})
	if (!REAL_COVER) {
		// 4:3, not the cover area's 16:9: the cover must not stretch the area.
		const png = solidPng(320, 240, COVER_RGB)
		await page.route(COVER_URL, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'image/png',
				headers: { 'access-control-allow-origin': '*' },
				body: png,
			}),
		)
	}
	await mockFanRpc(page, {
		'UserService/Get': {
			user: {
				id: { value: FAN_SUB },
				email: { value: 'fan@example.com' },
				home: { countryCode: 'JP', level1: 'JP-13' },
				fullName: { value: '山田 花子' },
				phoneNumber: { value: '+819012345678' },
			},
		},
		'ConcertService/Get': concertWire({ concert: concert() }),
		'TicketService/List': () => ({
			body: {
				tickets: TICKETS.map((id) => ticketWire(id, admittedAt || undefined)),
			},
		}),
		'OrderService/Get': {
			order: {
				id: { value: ORDER_ID },
				userId: { value: FAN_SUB },
				ticketStockId: { value: STOCK_ID },
				ticketCount: 2,
				status: 'ORDER_STATUS_PAID',
			},
		},
		'TicketSaleService/ListByEvent': {
			ticketSales: [],
			ticketStocks: [
				{
					id: { value: STOCK_ID },
					eventId: { value: EVENT_ID },
					seatTypeId: { value: SEAT_TYPE_ID },
					state: 'TICKET_STOCK_STATE_SOLD_OUT',
					resaleOpen: false,
				},
			],
			seatTypes: [
				{
					id: { value: SEAT_TYPE_ID },
					name: { value: 'S席' },
					price: { value: '6000' },
				},
			],
			perAccountLimit: 4,
		},
		'WalletPublicKeyService/Get': () => connectError('not_found', 404),
		'WalletPublicKeyService/Register': { replacedOtherKey: false },
	})
	return {
		admit: () => {
			admittedAt = new Date().toISOString()
		},
	}
}

interface Rect {
	x: number
	y: number
	width: number
	height: number
}

/**
 * The front's size and the boxes of its parts relative to it, as laid out:
 * the ticket tilts and is scaled to its stage on screen, and the share image
 * is made at the layout size, so the boxes on screen would not match it.
 * Each part is positioned against the front.
 */
async function faceLayout(face: Locator, selectors: string[]) {
	return face.evaluate((el: HTMLElement, selectors) => {
		const rects = selectors.map((selector) => {
			const part = el.querySelector<HTMLElement>(selector)
			if (!part) throw new Error(`no ${selector}`)
			if (part.offsetParent !== el)
				throw new Error(`${selector} is not positioned against the front`)
			return {
				x: part.offsetLeft,
				y: part.offsetTop,
				width: part.offsetWidth,
				height: part.offsetHeight,
			}
		})
		return { width: el.offsetWidth, height: el.offsetHeight, rects }
	}, selectors)
}

/**
 * Read pixels of the shared image: a 5x3 grid inside each rectangle (given
 * in the face's CSS pixels, scaled to the image).
 */
async function sharedPixels(page: Page, faceWidth: number, rects: Rect[]) {
	return page.evaluate(
		async ({ faceWidth, rects }) => {
			const file = (navigator as Navigator & { __sharedFile?: File })
				.__sharedFile
			if (!file) throw new Error('nothing was shared')
			const bitmap = await createImageBitmap(file)
			const canvas = document.createElement('canvas')
			canvas.width = bitmap.width
			canvas.height = bitmap.height
			const ctx = canvas.getContext('2d')
			if (!ctx) throw new Error('no 2d context')
			ctx.drawImage(bitmap, 0, 0)
			const scale = bitmap.width / faceWidth
			const grids = rects.map((r) => {
				const points: number[][] = []
				for (let i = 1; i <= 5; i++) {
					for (let j = 1; j <= 3; j++) {
						const x = Math.round((r.x + (r.width * i) / 6) * scale)
						const y = Math.round((r.y + (r.height * j) / 4) * scale)
						points.push([...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)])
					}
				}
				return points
			})
			return {
				type: file.type,
				name: file.name,
				width: bitmap.width,
				height: bitmap.height,
				grids,
				dataUrl: canvas.toDataURL('image/png'),
			}
		},
		{ faceWidth, rects },
	)
}

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
	await expect
		.poll(() =>
			page.evaluate(
				() => !!(navigator as Navigator & { __sharedFile?: File }).__sharedFile,
			),
		)
		.toBe(true)
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
