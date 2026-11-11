import { I18nConfiguration } from '@aurelia/i18n'
import { createFixture } from '@aurelia/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ja from '../../src/locales/ja/translation.json'
import type { EventPageEvent } from '../../src/routes/event/event-page'
import {
	AdmissionStamp,
	STAMP_ANIMATION,
} from '../../src/routes/tickets/virtual-ticket/admission-stamp'
import {
	PRESET_CHOSEN,
	VirtualTicket,
} from '../../src/routes/tickets/virtual-ticket/virtual-ticket'
import type {
	WalletPersonalDetails,
	WalletTicket,
} from '../../src/routes/tickets/wallet-view'

const i18n = I18nConfiguration.customize((options) => {
	options.initOptions = {
		lng: 'ja',
		resources: { ja: { translation: ja } },
		fallbackLng: 'ja',
		interpolation: { escapeValue: false },
	}
})

/** An instant at the given Japan-time hour on a 2026-11 day. */
function jst(day: number, hour: number, minute = 0): Date {
	return new Date(Date.UTC(2026, 10, day, hour - 9, minute))
}

const EVENT: EventPageEvent = {
	id: 'event-1',
	seriesId: 'series-1',
	title: 'Autumn Tour 2026',
	description: '',
	coverUrl: 'https://cdn.liverty-music.app/cdn/org/cover/large.webp',
	performers: [
		{ id: 'a-1', name: 'The Band', mbid: '' },
		{ id: 'a-2', name: 'Guest', mbid: '' },
	],
	dateKey: '2026-11-20',
	date: new Date(2026, 10, 20),
	openTime: jst(20, 17, 30),
	startTime: jst(20, 18, 30),
	venueName: 'Shibuya WWW',
	adminArea: 'JP-13',
	cancelled: false,
}

function ticket(o: Partial<WalletTicket> = {}): WalletTicket {
	return {
		id: 'ticket-1',
		eventId: 'event-1',
		orderId: 'order-1',
		userId: 'user-1',
		resaleWithoutConsentProhibited: true,
		state: 'not-entered',
		admitTime: null,
		seatTypeName: 'S席',
		...o,
	}
}

const ENTERED = ticket({ state: 'entered', admitTime: jst(20, 18, 2) })

const PERSON: WalletPersonalDetails = {
	fullName: '山田太郎',
	phoneNumber: '+819012345678',
}

interface Host {
	event: EventPageEvent | null
	ticket: WalletTicket
	person: WalletPersonalDetails
	press: boolean
	pressed: number
}

async function mount(o: Partial<Host> = {}) {
	const host: Host = {
		event: EVENT,
		ticket: ticket(),
		person: PERSON,
		press: false,
		pressed: 0,
		...o,
	}
	const fixture = await createFixture
		.html(
			`<virtual-ticket event.bind="event" ticket.bind="ticket" personal-details.bind="person" press-stamp.bind="press" stamp-pressed.trigger="pressed = pressed + 1"></virtual-ticket>`,
		)
		.component(host)
		.deps(i18n, VirtualTicket, AdmissionStamp)
		.build().started
	const face = fixture.appHost.querySelector<HTMLElement>('.virtual-ticket')
	if (!face) throw new Error('no face')
	return { fixture, host, face }
}

function text(el: Element): string {
	return (el.textContent ?? '').replace(/\s+/g, ' ')
}

function animationEnd(name: string): Event {
	const event = new Event('animationend', { bubbles: true })
	Object.defineProperty(event, 'animationName', { value: name })
	return event
}

function reduceMotion(): void {
	vi.spyOn(window, 'matchMedia').mockImplementation(
		(query: string) =>
			({
				matches: query.includes('reduce'),
				media: query,
			}) as MediaQueryList,
	)
}

describe('virtual-ticket', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('shows every item of the front as text, with the cover and no QR code or personal details', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Fan taps a ticket"
		const { face } = await mount()
		const all = text(face)

		const cover = face.querySelector<HTMLImageElement>(
			'.ticket-front-cover img',
		)
		expect(cover?.getAttribute('src')).toBe(EVENT.coverUrl)
		// Loaded with CORS so it can be drawn into the art and the share image.
		expect(cover?.getAttribute('crossorigin')).toBe('anonymous')
		expect(all).toContain('The Band / Guest')
		expect(all).toContain('Autumn Tour 2026')
		expect(all).toContain('2026.11.20')
		expect(all).toContain('Shibuya WWW')
		// The prefecture as a localized name, never the ISO code.
		expect(all).toContain('東京都')
		expect(all).not.toContain('JP-13')
		expect(all).toContain('17:30')
		expect(all).toContain('18:30')
		expect(all).toContain('S席')
		expect(all).toContain('指定なし')
		// The front holds no personal details, no QR code and no ticket id.
		expect(all).not.toContain('山田太郎')
		expect(all).not.toContain('090-1234-5678')
		expect(face.querySelector('img:not(.ticket-front-cover-image)')).toBeNull()
		expect(face.innerHTML).not.toContain('ticket-1')
	})

	it('shows the eligible person and the two statements on the back', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Fan turns the ticket over"
		const { fixture, face } = await mount()
		const back = fixture.appHost.querySelector<HTMLElement>('.ticket-back')
		if (!back) throw new Error('no back')
		const card = fixture.appHost.querySelector('.virtual-ticket-card')
		// The side that is turned away cannot be reached.
		expect(card?.getAttribute('data-side')).toBe('front')
		expect(back.inert).toBe(true)

		// A tap on the ticket turns it over.
		face.click()
		await fixture.tasksSettled
		expect(card?.getAttribute('data-side')).toBe('back')
		expect(back.inert).toBe(false)
		expect(face.inert).toBe(true)

		const all = text(back)
		for (const item of [
			'The Band / Guest',
			'Autumn Tour 2026',
			'2026年11月20日',
			'Shibuya WWW',
			'東京都',
			'17:30 / 18:30',
			'S席 / 指定なし',
			'山田太郎',
			'090-1234-5678',
			ja.tickets.virtual.noResale,
			ja.tickets.virtual.verified,
		]) {
			expect(all).toContain(item)
		}
		expect(back.innerHTML).not.toContain('ticket-1')

		// The button turns it back.
		fixture.appHost
			.querySelector<HTMLElement>('[data-testid="virtual-ticket-flip"]')
			?.click()
		await fixture.tasksSettled
		expect(card?.getAttribute('data-side')).toBe('front')
	})

	it('leaves the transfer statement off a ticket that may be transferred', async () => {
		const { fixture } = await mount({
			ticket: ticket({ resaleWithoutConsentProhibited: false }),
		})
		const back = text(fixture.appHost.querySelector('.ticket-back') as Element)
		expect(back).not.toContain(ja.tickets.virtual.noResale)
		expect(back).toContain(ja.tickets.virtual.verified)
	})

	it('shows the design the fan picks and tells the screen which', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Fan picks a design"
		const { fixture } = await mount()
		const card = fixture.appHost.querySelector('.virtual-ticket-card')
		expect(card?.getAttribute('data-preset')).toBe('default')
		const picked: string[] = []
		fixture.appHost.addEventListener(PRESET_CHOSEN, (event) => {
			picked.push((event as CustomEvent<{ preset: string }>).detail.preset)
		})

		const options = [
			...fixture.appHost.querySelectorAll<HTMLElement>(
				'[data-testid="virtual-ticket-preset"]',
			),
		]
		expect(options.map((o) => o.getAttribute('data-preset'))).toEqual([
			'default',
			'rock',
			'pop',
			'jazz',
			'classic',
			'electronic',
		])
		options[3].click()
		await fixture.tasksSettled

		expect(card?.getAttribute('data-preset')).toBe('jazz')
		expect(options[3].getAttribute('aria-pressed')).toBe('true')
		expect(picked).toEqual(['jazz'])
		// Picking a design does not turn the ticket over.
		expect(card?.getAttribute('data-side')).toBe('front')
	})

	it('colours the ticket with the first performer’s hue', async () => {
		const hueOf = (root: Element): string =>
			root
				.querySelector<HTMLElement>('.virtual-ticket-card')
				?.style.getPropertyValue('--artist-hue') ?? ''
		const { fixture } = await mount()
		expect(Number.isInteger(Number(hueOf(fixture.appHost)))).toBe(true)
		expect(hueOf(fixture.appHost)).not.toBe('')
		const { fixture: other } = await mount({
			event: { ...EVENT, performers: [{ id: 'x', name: 'Another', mbid: '' }] },
		})
		expect(hueOf(other.appHost)).not.toBe(hueOf(fixture.appHost))
	})

	it('opens with every item and without the cover when the cover cannot load', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Opened in the venue without a connection"
		const { fixture, face } = await mount()
		face
			.querySelector('.ticket-front-cover img')
			?.dispatchEvent(new Event('error'))
		await fixture.tasksSettled

		expect(face.querySelector('.ticket-front-cover')).toBeNull()
		const all = text(face)
		for (const item of [
			'Autumn Tour 2026',
			'Shibuya WWW',
			'東京都',
			'S席',
			'指定なし',
		]) {
			expect(all).toContain(item)
		}
	})

	it('shows no cover area for an event without a cover', async () => {
		const { face } = await mount({ event: { ...EVENT, coverUrl: '' } })
		expect(face.querySelector('.ticket-front-cover')).toBeNull()
	})

	it('names the front by its title and keeps every item as text for a screen reader', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Reading the ticket aloud"
		const { fixture, face } = await mount({ ticket: ENTERED })
		const title = face.ownerDocument.getElementById(
			face.getAttribute('aria-labelledby') ?? '',
		)
		expect(title?.textContent?.trim()).toBe('Autumn Tour 2026')
		// The drawn art is decoration: the canvas is hidden from assistive
		// technology, and what it shows is also there as text.
		expect(face.querySelector('canvas')?.getAttribute('aria-hidden')).toBe(
			'true',
		)
		// Each fact is a term with its value, read in that order.
		const terms = [...face.querySelectorAll('dt')].map((dt) => text(dt).trim())
		expect(terms).toEqual([
			'会場 東京都',
			'日付 金',
			'開場',
			'開演',
			'席種',
			'座席',
		])
		// The stamp is text too: 入場済, ringed by the event's date.
		const stamp = face.querySelector('admission-stamp')
		expect(text(stamp as Element)).toContain('入場済')
		expect(text(stamp as Element)).toContain('2026.11.20')
		expect(stamp?.querySelector('time')).toBeNull()
		// Turned over, the back is the side that can be reached: it is
		// named, and the eligible person is a term with its value.
		const back = fixture.appHost.querySelector<HTMLElement>('.ticket-back')
		expect(back?.inert).toBe(true)
		face.click()
		await fixture.tasksSettled
		expect(back?.inert).toBe(false)
		expect(face.inert).toBe(true)
		expect(back?.getAttribute('aria-label')).toBe(ja.tickets.virtual.back)
		const holder = [...(back?.querySelectorAll('dt') ?? [])].find(
			(dt) => text(dt).trim() === ja.tickets.virtual.eligiblePerson,
		)
		expect(text(holder?.nextElementSibling as Element)).toContain('山田太郎')
	})

	it('shows no stamp on a ticket that is not yet entered', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Not yet entered"
		const { face } = await mount({ ticket: ticket(), press: true })
		expect(face.querySelector('admission-stamp')).toBeNull()
	})

	it('presses the stamp and tells the screen once the animation has played', async () => {
		const { face, host } = await mount({ ticket: ENTERED, press: true })
		const stamp = face.querySelector('[data-stamp]')
		expect(stamp?.getAttribute('data-stamp')).toBe('press')

		// Another animation ending inside the face is not the stamp's.
		stamp?.dispatchEvent(animationEnd('something-else'))
		expect(host.pressed).toBe(0)
		stamp?.dispatchEvent(animationEnd(STAMP_ANIMATION))
		expect(host.pressed).toBe(1)
	})

	it('shows the stamp at rest when it has been played before', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Opened again"
		const { face, host } = await mount({ ticket: ENTERED, press: false })
		const stamp = face.querySelector('[data-stamp]')
		expect(stamp?.getAttribute('data-stamp')).toBe('rest')
		stamp?.dispatchEvent(animationEnd(STAMP_ANIMATION))
		expect(host.pressed).toBe(0)
	})

	it('shows the stamp at rest with reduced motion and records nothing', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Reduced motion"
		reduceMotion()
		const { face, host } = await mount({ ticket: ENTERED, press: true })
		const stamp = face.querySelector('[data-stamp]')
		expect(stamp?.getAttribute('data-stamp')).toBe('rest')
		stamp?.dispatchEvent(animationEnd(STAMP_ANIMATION))
		expect(host.pressed).toBe(0)
	})

	it('shows the event as unknown when its details could not be read', async () => {
		const { fixture, face } = await mount({ event: null })
		expect(text(face)).toContain(ja.tickets.event.unknown)
		// The back still names the eligible person.
		expect(
			text(fixture.appHost.querySelector('.ticket-back') as Element),
		).toContain('山田太郎')
	})
})
