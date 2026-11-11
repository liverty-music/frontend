import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor } from 'storybook/test'
import type { EventPageEvent } from '../../event/event-page'
import type { WalletPersonalDetails, WalletTicket } from '../wallet-view'
import { AdmissionStamp, STAMP_ANIMATION } from './admission-stamp'
import type { TicketPreset } from './ticket-presets'
import { VirtualTicket } from './virtual-ticket'

/**
 * A cover drawn inline, so the stories load nothing from the network: the
 * liquid art of the design sample, large enough to be cropped.
 */
const COVER = `data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1208" viewBox="0 0 300 302" preserveAspectRatio="xMidYMid slice"><defs><filter id="liq1" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.008 0.013" numOctaves="3" seed="11"/><feDisplacementMap in="SourceGraphic" scale="110" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="0.8"/></filter><radialGradient id="pk1"><stop offset="0" stop-color="#ffe0f2"/><stop offset=".5" stop-color="#ff4fa3"/><stop offset="1" stop-color="#b3126d" stop-opacity="0"/></radialGradient><radialGradient id="bub1" cx="35%" cy="30%" r="65%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".3" stop-color="#ffd0ea" stop-opacity=".55"/><stop offset="1" stop-color="#ff4fa3" stop-opacity="0"/></radialGradient><linearGradient id="shade1" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs><rect width="300" height="302" fill="#123039"/><g filter="url(#liq1)"><rect x="-40" y="-40" width="380" height="120" fill="#cdb9ea"/><ellipse cx="70" cy="50" rx="150" ry="70" fill="#eaa6d8"/><ellipse cx="235" cy="150" rx="70" ry="170" fill="#0f2c35"/><ellipse cx="150" cy="165" rx="170" ry="38" fill="url(#pk1)"/><ellipse cx="265" cy="40" rx="60" ry="95" fill="#ff3d9a"/><ellipse cx="50" cy="270" rx="160" ry="60" fill="#f4c6e8"/><ellipse cx="210" cy="285" rx="95" ry="38" fill="#ff5fae"/><ellipse cx="120" cy="215" rx="40" ry="18" fill="#1b4450"/></g><g><circle cx="58" cy="30" r="9" fill="url(#bub1)"/><circle cx="214" cy="96" r="14" fill="url(#bub1)"/><circle cx="246" cy="70" r="6" fill="url(#bub1)"/><circle cx="36" cy="236" r="11" fill="url(#bub1)"/><circle cx="268" cy="250" r="8" fill="url(#bub1)"/><circle cx="160" cy="62" r="5" fill="url(#bub1)"/></g><rect width="300" height="302" fill="url(#shade1)"/></svg>',
)}`

function svgCover(body: string): string {
	return `data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 300 300">${body}</svg>`,
	)}`
}

/** Stage lights over a crowd. */
const COVER_ROCK = svgCover(
	'<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><filter id="f"><feGaussianBlur stdDeviation="5"/></filter></defs><rect width="300" height="300" fill="#0b0b0d"/><g filter="url(#f)" opacity=".85"><polygon points="60,0 80,0 170,300 10,300" fill="url(#b)"/><polygon points="150,0 170,0 250,300 90,300" fill="url(#b)" opacity=".7"/><polygon points="240,0 260,0 330,300 150,300" fill="url(#b)" opacity=".85"/></g><g fill="#050506"><circle cx="20" cy="290" r="26"/><circle cx="70" cy="298" r="30"/><circle cx="125" cy="288" r="27"/><circle cx="180" cy="300" r="32"/><circle cx="235" cy="290" r="28"/><circle cx="285" cy="296" r="27"/><rect x="118" y="230" width="6" height="50" transform="rotate(-18 121 255)"/><rect x="228" y="236" width="6" height="46" transform="rotate(14 231 259)"/></g>',
)

/** A record turning under a lamp. */
const COVER_JAZZ = svgCover(
	'<defs><radialGradient id="l" cx="70%" cy="20%" r="80%"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#999"/><stop offset="1" stop-color="#111"/></radialGradient></defs><rect width="300" height="300" fill="url(#l)"/><g fill="none" stroke="#000" stroke-opacity=".55"><circle cx="110" cy="190" r="150" stroke-width="26"/><circle cx="110" cy="190" r="112" stroke-width="14"/><circle cx="110" cy="190" r="84" stroke-width="10"/><circle cx="110" cy="190" r="58" stroke-width="8"/></g><circle cx="110" cy="190" r="34" fill="#eee"/><circle cx="110" cy="190" r="5" fill="#111"/><circle cx="238" cy="62" r="34" fill="#fff" opacity=".9"/>',
)

/** A dark hall with warm lights out of focus. */
const COVER_CLASSIC = svgCover(
	'<defs><filter id="f"><feGaussianBlur stdDeviation="7"/></filter></defs><rect width="300" height="300" fill="#070707"/><g filter="url(#f)" fill="#fff"><circle cx="50" cy="60" r="22" opacity=".8"/><circle cx="120" cy="40" r="14" opacity=".6"/><circle cx="200" cy="70" r="26" opacity=".85"/><circle cx="262" cy="36" r="12" opacity=".6"/><circle cx="90" cy="130" r="18" opacity=".5"/><circle cx="170" cy="150" r="30" opacity=".7"/><circle cx="250" cy="140" r="16" opacity=".5"/><circle cx="40" cy="200" r="24" opacity=".45"/><circle cx="130" cy="230" r="14" opacity=".4"/><circle cx="220" cy="230" r="22" opacity=".5"/></g>',
)

/** A sun setting over a grid. */
const COVER_ELECTRONIC = svgCover(
	'<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#111"/><stop offset="1" stop-color="#777"/></linearGradient><linearGradient id="u" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#bbb"/></linearGradient></defs><rect width="300" height="300" fill="url(#s)"/><circle cx="150" cy="150" r="78" fill="url(#u)"/><g fill="#555"><rect x="60" y="150" width="180" height="5"/><rect x="60" y="166" width="180" height="7"/><rect x="60" y="184" width="180" height="9"/></g><rect y="200" width="300" height="100" fill="#0a0a0a"/><g stroke="#ddd" stroke-width="1.2"><path d="M0 212h300M0 228h300M0 250h300M0 280h300"/><path d="M150 200L150 300M110 200L60 300M70 200L-40 300M190 200L240 300M230 200L340 300M30 200L-150 300M270 200L450 300"/></g>',
)

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

/** A dark room around the ticket, as the bottom sheet gives it in the app. */
const ROOM =
	'display: grid; justify-items: center; gap: 1rem; padding: 2rem 1rem; min-block-size: 100dvh; box-sizing: border-box; background: radial-gradient(120% 60% at 50% 0%, #2a1f4d, #120d24 70%);'

function ticketStory(
	o: {
		event?: EventPageEvent | null
		ticket?: WalletTicket
		pressStamp?: boolean
		replay?: boolean
		preset?: TicketPreset
		drawing?: 'dom' | 'canvas'
	} = {},
) {
	return defineAureliaStory({
		template: `<div style="${ROOM}">
			<virtual-ticket event.bind="event" ticket.bind="ticket" personal-details.bind="person" press-stamp.bind="pressStamp" preset.bind="preset" drawing.bind="drawing"></virtual-ticket>
			<button if.bind="canReplay" type="button" click.trigger="replay()" style="padding: 0.5rem 1rem; border-radius: 999px; border: 1px solid #fff6; background: none; color: #fff; cursor: pointer;">スタンプを押す</button>
		</div>`,
		props: {
			event: o.event === undefined ? EVENT : o.event,
			ticket: o.ticket ?? NOT_ENTERED,
			person: PERSON,
			pressStamp: o.pressStamp ?? false,
			canReplay: o.replay ?? false,
			preset: o.preset ?? 'default',
			drawing: o.drawing ?? 'canvas',
			replay(this: { ticket: WalletTicket; pressStamp: boolean }) {
				this.pressStamp = false
				this.ticket = NOT_ENTERED
				setTimeout(() => {
					this.ticket = ENTERED
					this.pressStamp = true
				}, 400)
			},
		},
		register: [VirtualTicket, AdmissionStamp],
	})
}

function faceOf(canvasElement: HTMLElement): HTMLElement {
	const face = canvasElement.querySelector<HTMLElement>('.virtual-ticket')
	if (!face) throw new Error('virtual ticket not rendered')
	return face
}

function backOf(canvasElement: HTMLElement): HTMLElement {
	const back = canvasElement.querySelector<HTMLElement>('.ticket-back')
	if (!back) throw new Error('back not rendered')
	return back
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

/**
 * 未入場: the front with its art under the holographic foil, the event's
 * facts as text, no personal details and no stamp. Move the pointer over the
 * ticket to tilt it.
 */
export const Front = {
	render: () => ticketStory(),
	play: async ({ canvasElement }) => {
		const face = faceOf(canvasElement)
		await coverLoaded(face)
		const text = face.textContent ?? ''
		for (const item of [
			'The Band / Guest Act',
			'Autumn Tour 2026',
			'2026.11.20',
			'Shibuya WWW',
			'東京都',
			'S席',
			'指定なし',
		]) {
			await expect(text).toContain(item)
		}
		await expect(text).not.toContain('山田太郎')
		await expect(face.querySelector('admission-stamp')).toBeNull()
	},
} satisfies Story

/**
 * The back, after turning the ticket over: the 特定興行入場券 face with the
 * eligible person's details and the two statements the law asks for.
 */
export const Back = {
	render: () => ticketStory(),
	play: async ({ canvasElement }) => {
		canvasElement
			.querySelector<HTMLButtonElement>('[data-testid="virtual-ticket-flip"]')
			?.click()
		const back = backOf(canvasElement)
		const text = back.textContent ?? ''
		for (const item of [
			'Autumn Tour 2026',
			'S席',
			'指定なし',
			'山田太郎',
			'090-1234-5678',
			'無断有償譲渡禁止',
			'入場資格者の氏名・連絡先確認済み',
		]) {
			await expect(text).toContain(item)
		}
		await expect(back.inert).toBe(false)
		await expect(faceOf(canvasElement).inert).toBe(true)
	},
} satisfies Story

/** 入場済み, seen before on this device: the stamp at rest on the front. */
export const EnteredAtRest = {
	render: () => ticketStory({ ticket: ENTERED }),
	play: async ({ canvasElement }) => {
		const face = faceOf(canvasElement)
		const stamp = face.querySelector<HTMLElement>('[data-stamp]')
		await expect(stamp?.getAttribute('data-stamp')).toBe('rest')
		await expect(stamp?.textContent).toContain('入場済')
		await expect(stamp?.querySelector('time')).toBeNull()
		await expect(getComputedStyle(stamp as HTMLElement).animationName).toBe(
			'none',
		)
	},
} satisfies Story

/**
 * 入場済み, shown for the first time on this device: once the drawing has
 * settled, the stamp is pressed onto the front, and where it lands a
 * shockwave runs through the drawing and sparks fly. The button presses it
 * again. Tagged `reduced-motion`, so it also runs with motion reduced, where
 * the stamp is shown at rest. Not screenshotted: the pressing makes the
 * frame non-deterministic.
 */
export const StampPressed = {
	tags: ['reduced-motion'],
	render: () =>
		ticketStory({ ticket: ENTERED, pressStamp: true, replay: true }),
	play: async ({ canvasElement }) => {
		const face = faceOf(canvasElement)
		// A stamp to be pressed appears once the drawing has settled, after
		// the renderers have started; one at rest appears at once.
		const stamp = await waitFor(
			() => {
				const found = face.querySelector<HTMLElement>('[data-stamp]')
				if (!found) throw new Error('no stamp yet')
				return found
			},
			{ timeout: 15_000 },
		)
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		if (reduced) {
			await expect(stamp.getAttribute('data-stamp')).toBe('rest')
			await expect(getComputedStyle(stamp).animationName).toBe('none')
		} else {
			await expect(stamp.getAttribute('data-stamp')).toBe('press')
			await expect(getComputedStyle(stamp).animationName).toBe(STAMP_ANIMATION)
			await expect(getComputedStyle(stamp).mixBlendMode).toBe('multiply')
			await Promise.all(stamp.getAnimations().map((a) => a.finished))
		}
	},
} satisfies Story

/** An event without a cover: lights of the first performer's hue instead. */
export const NoCover = {
	render: () => ticketStory({ event: { ...EVENT, coverUrl: '' } }),
	play: async ({ canvasElement }) => {
		const face = faceOf(canvasElement)
		await expect(face.querySelector('.ticket-front-cover')).toBeNull()
		await expect(face.textContent).toContain('Autumn Tour 2026')
	},
} satisfies Story

/**
 * An event whose details could not be read: the front says so and still
 * shows the ticket's own items.
 */
export const EventUnknown = {
	render: () => ticketStory({ event: null }),
	play: async ({ canvasElement }) => {
		const face = faceOf(canvasElement)
		await expect(face.textContent).toContain(
			'イベント情報を読み込めませんでした',
		)
		await expect(face.textContent).toContain('S席')
	},
} satisfies Story

function presetStory(
	preset: TicketPreset,
	event: Partial<EventPageEvent>,
	seatTypeName: string,
) {
	return {
		render: () =>
			ticketStory({
				preset,
				event: { ...EVENT, ...event },
				ticket: { ...NOT_ENTERED, seatTypeName },
				replay: true,
			}),
	} satisfies Story
}

/** Rock: a photocopied gig flyer in black and hot pink. */
export const PresetRock = presetStory(
	'rock',
	{
		title: 'LOUD & CLEAR TOUR',
		coverUrl: COVER_ROCK,
		performers: [{ id: 'a-1', name: 'Broken Amps', mbid: '' }],
		venueName: 'Shimokitazawa Shelter',
	},
	'スタンディング',
)

/** Pop: a holographic sticker on pastel paper. */
export const PresetPop = presetStory(
	'pop',
	{
		title: 'Sparkle Parade 2026',
		coverUrl: COVER,
		performers: [{ id: 'a-1', name: 'Milky Planet', mbid: '' }],
		venueName: 'Zepp Haneda',
	},
	'一般',
)

/** Jazz: a club poster on cream stock. */
export const PresetJazz = presetStory(
	'jazz',
	{
		title: 'Late Night Session',
		coverUrl: COVER_JAZZ,
		performers: [{ id: 'a-1', name: 'Blue Hour Quartet', mbid: '' }],
		venueName: 'Blue Note Tokyo',
	},
	'テーブル席',
)

/** Classic: a gala invitation in black with gold foil. */
export const PresetClassic = presetStory(
	'classic',
	{
		title: 'Symphony No. 9',
		coverUrl: COVER_CLASSIC,
		performers: [{ id: 'a-1', name: 'Tokyo Philharmonia', mbid: '' }],
		venueName: 'Suntory Hall',
	},
	'S席',
)

/** Electronic: a night flight in navy, cyan and magenta. */
export const PresetElectronic = presetStory(
	'electronic',
	{
		title: 'Afterglow Rave',
		coverUrl: COVER_ELECTRONIC,
		performers: [{ id: 'a-1', name: 'Neon Circuit', mbid: '' }],
		venueName: 'ageHa',
	},
	'フロア',
)

/**
 * The longest text a ticket has to carry: nothing leaves the ticket; long
 * names are cut at the end of their lines.
 */
export const LongText = {
	render: () =>
		ticketStory({
			preset: 'rock',
			event: {
				...EVENT,
				title:
					'The Very Long Anniversary World Tour 2026-2027 Final Extra Show',
				coverUrl: COVER_ROCK,
				performers: [
					{
						id: 'a-1',
						name: 'The Extraordinarily Long Named Orchestra',
						mbid: '',
					},
					{ id: 'a-2', name: 'Special Guest Friends', mbid: '' },
				],
				venueName: '東京国際フォーラム ホールA 特設ステージ（屋外エリア）',
			},
			ticket: {
				...ENTERED,
				seatTypeName: 'プレミアムスタンディング（前方エリア）',
			},
		}),
	play: async ({ canvasElement }) => {
		const face = faceOf(canvasElement)
		const box = face.getBoundingClientRect()
		// The stamp is rotated, so its box is not its ink: leave it out.
		for (const el of face.querySelectorAll<HTMLElement>(
			'dd, h2, p:not(.admission-stamp)',
		)) {
			const r = el.getBoundingClientRect()
			await expect(r.bottom).toBeLessThanOrEqual(box.bottom + 1)
			await expect(r.right).toBeLessThanOrEqual(box.right + 1)
		}
	},
} satisfies Story

/**
 * The whole ticket drawn as a sheet with HTML-in-Canvas, as every story is
 * in Chrome 157 or later. Both sides are still live DOM, but their pixels go
 * through WebGL: the sheet bends as it turns over, and the foil and the
 * stamp's shockwave run through the lettering.
 */
export const HtmlInCanvas = {
	render: () =>
		ticketStory({
			preset: 'pop',
			drawing: 'canvas',
			event: {
				...EVENT,
				title: 'Sparkle Parade 2026',
				performers: [{ id: 'a-1', name: 'Milky Planet', mbid: '' }],
				venueName: 'Zepp Haneda',
			},
			replay: true,
		}),
} satisfies Story

/**
 * The DOM version, as Safari and Firefox show it: both sides stay in the
 * page, WebGL draws only the art, and the ticket turns over as a rigid card.
 */
export const DomVersion = {
	render: () =>
		ticketStory({
			preset: 'pop',
			drawing: 'dom',
			event: {
				...EVENT,
				title: 'Sparkle Parade 2026',
				performers: [{ id: 'a-1', name: 'Milky Planet', mbid: '' }],
				venueName: 'Zepp Haneda',
			},
			replay: true,
		}),
} satisfies Story
