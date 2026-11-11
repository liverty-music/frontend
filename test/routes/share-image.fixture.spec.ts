import { I18nConfiguration } from '@aurelia/i18n'
import { createFixture } from '@aurelia/testing'
import { describe, expect, it, vi } from 'vitest'
import ja from '../../src/locales/ja/translation.json'
import type { EventPageEvent } from '../../src/routes/event/event-page'
import { AdmissionStamp } from '../../src/routes/tickets/virtual-ticket/admission-stamp'
import {
	SHARE_FILE_NAME,
	ShareImage,
	type ShareImageEnv,
} from '../../src/routes/tickets/virtual-ticket/share-image'
import { VirtualTicket } from '../../src/routes/tickets/virtual-ticket/virtual-ticket'
import type { WalletTicket } from '../../src/routes/tickets/wallet-view'

const i18n = I18nConfiguration.customize((options) => {
	options.initOptions = {
		lng: 'ja',
		resources: { ja: { translation: ja } },
		fallbackLng: 'ja',
		interpolation: { escapeValue: false },
	}
})

const COVER_URL = 'https://cdn.liverty-music.app/cdn/org/cover/large.webp'

const EVENT: EventPageEvent = {
	id: 'event-1',
	seriesId: 'series-1',
	title: 'Autumn Tour 2026',
	description: '',
	coverUrl: COVER_URL,
	performers: [{ id: 'a-1', name: 'The Band', mbid: '' }],
	dateKey: '2026-11-20',
	date: new Date(2026, 10, 20),
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

const ENTERED = ticket({
	state: 'entered',
	admitTime: new Date(Date.UTC(2026, 10, 20, 9, 2)),
})

async function liveFace(t: WalletTicket): Promise<HTMLElement> {
	const fixture = await createFixture
		.html(
			'<virtual-ticket event.bind="event" ticket.bind="ticket" personal-details.bind="person"></virtual-ticket>',
		)
		.component({
			event: EVENT,
			ticket: t,
			person: { fullName: '山田太郎', phoneNumber: '+819012345678' },
		})
		.deps(i18n, VirtualTicket, AdmissionStamp)
		.build().started
	const face = fixture.appHost.querySelector<HTMLElement>('.virtual-ticket')
	if (!face) throw new Error('no face')
	return face
}

/** A fake browser: records what was drawn and what was handed over. */
function fakeEnv(o: { canShare?: boolean } = {}) {
	const drawn: { clone: HTMLElement; art: HTMLCanvasElement | null }[] = []
	const env = {
		render: vi.fn(
			async (
				clone: HTMLElement,
				_face: HTMLElement,
				art: HTMLCanvasElement | null,
			) => {
				drawn.push({ clone, art })
				return new Blob(['png'], { type: 'image/png' })
			},
		),
		navigator: {
			canShare: vi.fn(() => o.canShare ?? true),
			share: vi.fn(async () => {}),
		},
		download: vi.fn(),
	} satisfies ShareImageEnv
	return { env, drawn }
}

function sharedFile(env: ReturnType<typeof fakeEnv>['env']): File {
	const data = env.navigator.share.mock.calls[0]?.[0] as ShareData | undefined
	const file = data?.files?.[0]
	if (!file) throw new Error('nothing shared')
	return file
}

describe('ShareImage', () => {
	it('hands the share sheet a PNG of the front, which holds no personal details', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Sharing from a phone"
		const face = await liveFace(ticket())
		const { env, drawn } = fakeEnv()
		const art = document.createElement('canvas')

		const outcome = await new ShareImage(env).share(face, art)

		expect(outcome).toBe('shared')
		const file = sharedFile(env)
		expect(file.name).toBe(SHARE_FILE_NAME)
		expect(file.type).toBe('image/png')
		const [{ clone, art: drawnArt }] = drawn
		expect(drawnArt).toBe(art)
		expect(clone.hasAttribute('data-share')).toBe(true)
		expect(clone.textContent).not.toContain('山田太郎')
		expect(clone.textContent).not.toContain('090-1234-5678')
		expect(clone.innerHTML).not.toContain('ticket-1')
		// The front's items are in the image.
		expect(clone.textContent).toContain('Autumn Tour 2026')
		expect(clone.textContent).toContain('S席')
		// The art is drawn under the copy: the copy holds no cover and no canvas.
		expect(clone.querySelector('img, canvas')).toBeNull()

		// The front the fan is looking at never changes.
		expect(face.hasAttribute('data-share')).toBe(false)
		expect(face.querySelector('img')?.getAttribute('src')).toBe(COVER_URL)
		expect(face.querySelector('canvas')).not.toBeNull()
	})

	it('leaves the stamp out of the image of an entered ticket', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Shared after entry"
		const face = await liveFace(ENTERED)
		const { env, drawn } = fakeEnv()

		await new ShareImage(env).share(face, null)

		expect(drawn[0].clone.querySelector('admission-stamp')).toBeNull()
		expect(drawn[0].clone.textContent).not.toContain('入場済')
		// Without the stamp the stub's bars are whole.
		expect(drawn[0].clone.hasAttribute('data-entered')).toBe(false)
		// The live front keeps its stamp.
		expect(face.querySelector('admission-stamp')).not.toBeNull()
	})

	it('downloads the image where the browser cannot share files', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Browser without file sharing"
		const face = await liveFace(ticket())
		const { env } = fakeEnv({ canShare: false })

		const outcome = await new ShareImage(env).share(face, null)

		expect(outcome).toBe('downloaded')
		expect(env.navigator.share).not.toHaveBeenCalled()
		const [file] = env.download.mock.calls[0]
		expect(file.name).toBe(SHARE_FILE_NAME)
		expect(file.type).toBe('image/png')
	})

	it('downloads where the browser has no canShare at all', async () => {
		const face = await liveFace(ticket())
		const { env } = fakeEnv()
		const nav = env.navigator as { canShare?: unknown }
		nav.canShare = undefined

		expect(await new ShareImage(env).share(face, null)).toBe('downloaded')
	})

	it('shares the front without the cover when the cover never loaded', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Sharing without the cover image"
		const face = await liveFace(ticket())
		// No connection: the cover fails to load, and the front drops it.
		face
			.querySelector('.ticket-front-cover img')
			?.dispatchEvent(new Event('error'))
		await vi.waitFor(() =>
			expect(face.querySelector('.ticket-front-cover')).toBeNull(),
		)
		const { env, drawn } = fakeEnv()

		const outcome = await new ShareImage(env).share(face, null)

		expect(outcome).toBe('shared')
		expect(sharedFile(env).type).toBe('image/png')
		// The image is made from the front's items alone.
		expect(drawn[0].clone.querySelector('img')).toBeNull()
		for (const item of ['Autumn Tour 2026', 'Shibuya WWW', 'S席']) {
			expect(drawn[0].clone.textContent).toContain(item)
		}
	})

	it('reports a closed share sheet as cancelled, and rethrows other failures', async () => {
		const face = await liveFace(ticket())
		const { env } = fakeEnv()
		env.navigator.share.mockRejectedValueOnce(
			new DOMException('closed', 'AbortError'),
		)
		expect(await new ShareImage(env).share(face, null)).toBe('cancelled')

		env.navigator.share.mockRejectedValueOnce(
			new DOMException('no', 'NotAllowedError'),
		)
		await expect(new ShareImage(env).share(face, null)).rejects.toThrow('no')
	})
})
