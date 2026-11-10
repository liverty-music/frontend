import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import type { EventPageEvent } from '../../event/event-page'
import type { WalletPersonalDetails, WalletTicket } from '../wallet-view'
import { AdmissionStamp, STAMP_ANIMATION } from './admission-stamp'
import { VirtualTicket } from './virtual-ticket'

/**
 * A cover drawn inline, so the stories load nothing from the network. Its
 * hue band matches nothing in particular; it only has to look like a photo
 * and be large enough to be cropped.
 */
const COVER = `data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b2a6b"/><stop offset="1" stop-color="#e0607e"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1150" cy="300" r="180" fill="#ffd36e" opacity="0.8"/></svg>',
)}`

/** An instant at the given Japan-time hour on 2026-11-20. */
function jst(hour: number, minute: number): Date {
	return new Date(Date.UTC(2026, 10, 20, hour - 9, minute))
}

const EVENT: EventPageEvent = {
	id: 'event-1',
	seriesId: 'series-1',
	title: 'Autumn Tour 2026',
	description: '',
	coverUrl: COVER,
	performers: [
		{ id: 'a-1', name: 'The Band', mbid: '' },
		{ id: 'a-2', name: 'Guest Act', mbid: '' },
	],
	dateKey: '2026-11-20',
	date: new Date(2026, 10, 20),
	openTime: jst(17, 30),
	startTime: jst(18, 30),
	venueName: 'Shibuya WWW',
	adminArea: 'JP-13',
	cancelled: false,
}

const NOT_ENTERED: WalletTicket = {
	id: 'ticket-1',
	eventId: 'event-1',
	orderId: 'order-1',
	userId: 'user-1',
	resaleWithoutConsentProhibited: true,
	state: 'not-entered',
	admitTime: null,
	seatTypeName: 'S席',
}

const ENTERED: WalletTicket = {
	...NOT_ENTERED,
	state: 'entered',
	admitTime: jst(18, 2),
}

const PERSON: WalletPersonalDetails = {
	fullName: '山田太郎',
	phoneNumber: '+819012345678',
}

function ticketStory(
	o: {
		event?: EventPageEvent | null
		ticket?: WalletTicket
		pressStamp?: boolean
	} = {},
) {
	return defineAureliaStory({
		template:
			'<virtual-ticket event.bind="event" ticket.bind="ticket" personal-details.bind="person" press-stamp.bind="pressStamp"></virtual-ticket>',
		props: {
			event: o.event === undefined ? EVENT : o.event,
			ticket: o.ticket ?? NOT_ENTERED,
			person: PERSON,
			pressStamp: o.pressStamp ?? false,
		},
		register: [VirtualTicket, AdmissionStamp],
	})
}

function faceOf(canvasElement: HTMLElement): HTMLElement {
	const face = canvasElement.querySelector<HTMLElement>('.virtual-ticket')
	if (!face) throw new Error('virtual ticket not rendered')
	return face
}

async function coverLoaded(face: HTMLElement): Promise<void> {
	const img = face.querySelector('img')
	if (img && !img.complete) await img.decode()
}

const meta = {
	title: 'Tickets/VirtualTicket',
	component: VirtualTicket,
	argTypes: {
		pressStamp: {
			control: 'boolean',
			description:
				'Press the stamp with its animation (an entered ticket shown for the first time on the device).',
		},
	},
} satisfies Meta<typeof VirtualTicket>

export default meta
type Story = StoryObj<typeof meta>

/** 未入場: the face with its cover, every item as text, and no stamp. */
export const NotEntered = {
	render: () => ticketStory(),
	play: async ({ canvasElement }) => {
		const face = faceOf(canvasElement)
		await coverLoaded(face)
		// The paper is tinted with the first performer's hue (an oklch colour,
		// not the transparent fallback of an unresolved --artist-hue).
		const body = face.querySelector<HTMLElement>('.virtual-ticket-body')
		if (!body) throw new Error('no body')
		await expect(getComputedStyle(body).backgroundColor).toContain('oklch')
		await expect(getComputedStyle(face).color).toContain('oklch')
		const text = face.textContent ?? ''
		for (const item of [
			'The Band / Guest Act',
			'Autumn Tour 2026',
			'Shibuya WWW',
			'東京都',
			'S席',
			'指定なし',
			'山田太郎',
			'090-1234-5678',
		]) {
			await expect(text).toContain(item)
		}
		await expect(face.querySelector('admission-stamp')).toBeNull()
		const cover = face.querySelector<HTMLElement>('.virtual-ticket-cover')
		await expect(cover?.getBoundingClientRect().height).toBeGreaterThan(0)
	},
} satisfies Story

/** 入場済み, seen before on this device: the stamp at rest over the face. */
export const EnteredAtRest = {
	render: () => ticketStory({ ticket: ENTERED }),
	play: async ({ canvasElement }) => {
		const face = faceOf(canvasElement)
		const stamp = face.querySelector<HTMLElement>('[data-stamp]')
		await expect(stamp?.getAttribute('data-stamp')).toBe('rest')
		await expect(stamp?.textContent).toContain('入場済')
		await expect(stamp?.querySelector('time')?.textContent).toContain('18:02')
		await expect(getComputedStyle(stamp as HTMLElement).animationName).toBe(
			'none',
		)
		// The stamp sits inside the face.
		const faceBox = face.getBoundingClientRect()
		const box = stamp?.getBoundingClientRect()
		await expect(box && box.bottom <= faceBox.bottom).toBe(true)
		await expect(box && box.right <= faceBox.right).toBe(true)
	},
} satisfies Story

/**
 * 入場済み, shown for the first time on this device: the stamp is pressed
 * onto the face. Tagged `reduced-motion`, so it also runs with motion
 * reduced, where the stamp is shown at rest. Not screenshotted: the pressing
 * makes the frame non-deterministic.
 */
export const StampPressed = {
	tags: ['reduced-motion'],
	render: () => ticketStory({ ticket: ENTERED, pressStamp: true }),
	play: async ({ canvasElement }) => {
		const face = faceOf(canvasElement)
		const stamp = face.querySelector<HTMLElement>('[data-stamp]')
		if (!stamp) throw new Error('no stamp')
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		if (reduced) {
			await expect(stamp.getAttribute('data-stamp')).toBe('rest')
			await expect(getComputedStyle(stamp).animationName).toBe('none')
		} else {
			await expect(stamp.getAttribute('data-stamp')).toBe('press')
			await expect(getComputedStyle(stamp).animationName).toBe(STAMP_ANIMATION)
			const ms =
				Number.parseFloat(getComputedStyle(stamp).animationDuration) * 1000
			await expect(ms).toBe(1500)
			await expect(getComputedStyle(stamp).mixBlendMode).toBe('multiply')
			await Promise.all(stamp.getAnimations().map((a) => a.finished))
		}
		// Either way it ends upright at its resting size.
		await expect(getComputedStyle(stamp).opacity).toBe('1')
	},
} satisfies Story

/** An event without a cover (or one that failed to load): no cover area. */
export const NoCover = {
	render: () => ticketStory({ event: { ...EVENT, coverUrl: '' } }),
	play: async ({ canvasElement }) => {
		const face = faceOf(canvasElement)
		await expect(face.querySelector('.virtual-ticket-cover')).toBeNull()
		await expect(face.textContent).toContain('Autumn Tour 2026')
	},
} satisfies Story

/**
 * An event whose details could not be read: the face says so and still
 * shows the ticket's own items, with no cover.
 */
export const EventUnknown = {
	render: () => ticketStory({ event: null }),
	play: async ({ canvasElement }) => {
		const face = faceOf(canvasElement)
		await expect(face.textContent).toContain(
			'イベント情報を読み込めませんでした',
		)
		await expect(face.textContent).toContain('S席')
		await expect(face.textContent).toContain('山田太郎')
		await expect(face.querySelector('.virtual-ticket-cover')).toBeNull()
	},
} satisfies Story

/**
 * The face as the share image draws it (`data-share`): the full name and
 * phone number are solid bars, the stamp is left out, and the cover's area
 * is left empty for the cover drawn under it.
 */
export const MaskedForSharing = {
	render: () => ticketStory({ ticket: ENTERED }),
	play: async ({ canvasElement }) => {
		const face = faceOf(canvasElement)
		face.setAttribute('data-share', '')
		for (const dd of face.querySelectorAll<HTMLElement>('[data-personal] dd')) {
			const style = getComputedStyle(dd)
			await expect(style.color).toBe('rgba(0, 0, 0, 0)')
			await expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
		}
		const stamp = face.querySelector<HTMLElement>('admission-stamp')
		await expect(stamp && getComputedStyle(stamp).display).toBe('none')
		const img = face.querySelector<HTMLElement>('.virtual-ticket-cover-image')
		await expect(img && getComputedStyle(img).visibility).toBe('hidden')
	},
} satisfies Story
