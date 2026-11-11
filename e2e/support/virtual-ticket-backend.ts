import { deflateSync } from 'node:zlib'
import type { Locator, Page } from '@playwright/test'
import { concertWire } from './concert-wire'
import { fakeId } from './fake-id'
import { connectError, FAN_SUB, mockFanRpc } from './fan-auth'
import { seedSignedInFan } from './fan-shell'

// The backend of the virtual ticket specs: one event with a cover, and two
// tickets of a signed-in fan that turn 入場済み once `admit()` is called.

const EVENT_ID = fakeId('virtual-ticket-event')
const ORDER_ID = fakeId('virtual-ticket-order')
const STOCK_ID = fakeId('virtual-ticket-stock')
const SEAT_TYPE_ID = fakeId('virtual-ticket-seat-type')
const TICKETS = [1, 2].map((i) => fakeId(`virtual-ticket-ticket-${i}`))
export const REAL_COVER = process.env.E2E_REAL_COVER ?? ''
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
export async function mockBackend(page: Page) {
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

export interface Rect {
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
export async function faceLayout(face: Locator, selectors: string[]) {
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
export async function sharedPixels(
	page: Page,
	faceWidth: number,
	rects: Rect[],
) {
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
