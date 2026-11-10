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
function fakeEnv(o: { canShare?: boolean; cover?: boolean } = {}) {
	const cover = { close: vi.fn() } as unknown as ImageBitmap
	const drawn: { clone: HTMLElement; cover: ImageBitmap | null }[] = []
	const env = {
		fetchCover: vi.fn(async () => (o.cover === false ? null : cover)),
		render: vi.fn(
			async (clone: HTMLElement, _face: HTMLElement, c: ImageBitmap | null) => {
				drawn.push({ clone, cover: c })
				return new Blob(['png'], { type: 'image/png' })
			},
		),
		navigator: {
			canShare: vi.fn(() => o.canShare ?? true),
			share: vi.fn(async () => {}),
		},
		download: vi.fn(),
	} satisfies ShareImageEnv
	return { env, drawn, cover }
}

function sharedFile(env: ReturnType<typeof fakeEnv>['env']): File {
	const data = env.navigator.share.mock.calls[0]?.[0] as ShareData | undefined
	const file = data?.files?.[0]
	if (!file) throw new Error('nothing shared')
	return file
}

describe('ShareImage', () => {
	it('hands the share sheet a PNG of the face with the name and phone number masked', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Sharing from a phone"
		const face = await liveFace(ticket())
		const { env, drawn, cover } = fakeEnv()

		const outcome = await new ShareImage(env).share(face, COVER_URL)

		expect(outcome).toBe('shared')
		const file = sharedFile(env)
		expect(file.name).toBe(SHARE_FILE_NAME)
		expect(file.type).toBe('image/png')
		expect(env.fetchCover).toHaveBeenCalledWith(COVER_URL)
		const [{ clone, cover: drawnCover }] = drawn
		expect(drawnCover).toBe(cover)
		expect(clone.hasAttribute('data-share')).toBe(true)
		expect(clone.textContent).not.toContain('山田太郎')
		expect(clone.textContent).not.toContain('090-1234-5678')
		expect(clone.innerHTML).not.toContain('ticket-1')
		// The rest of the face is in the image.
		expect(clone.textContent).toContain('Autumn Tour 2026')
		expect(clone.textContent).toContain('S席')
		// The cover is drawn under the copy, not loaded inside it.
		expect(clone.querySelector('img')?.hasAttribute('src')).toBe(false)
		expect(cover.close).toHaveBeenCalled()

		// The face the fan is looking at never changes.
		expect(face.hasAttribute('data-share')).toBe(false)
		expect(face.textContent).toContain('山田太郎')
		expect(face.textContent).toContain('090-1234-5678')
		expect(face.querySelector('img')?.getAttribute('src')).toBe(COVER_URL)
	})

	it('leaves the stamp out of the image of an entered ticket', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Shared after entry"
		const face = await liveFace(ENTERED)
		const { env, drawn } = fakeEnv()

		await new ShareImage(env).share(face, COVER_URL)

		expect(drawn[0].clone.querySelector('admission-stamp')).toBeNull()
		expect(drawn[0].clone.textContent).not.toContain('入場済')
		// The live face keeps its stamp.
		expect(face.querySelector('admission-stamp')).not.toBeNull()
	})

	it('downloads the image where the browser cannot share files', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Browser without file sharing"
		const face = await liveFace(ticket())
		const { env } = fakeEnv({ canShare: false })

		const outcome = await new ShareImage(env).share(face, COVER_URL)

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

		expect(await new ShareImage(env).share(face, COVER_URL)).toBe('downloaded')
	})

	it('makes the masked image without the cover when it cannot be fetched', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Sharing without the cover image"
		const face = await liveFace(ticket())
		const { env, drawn } = fakeEnv({ cover: false })

		const outcome = await new ShareImage(env).share(face, COVER_URL)

		expect(outcome).toBe('shared')
		expect(drawn[0].cover).toBeNull()
		expect(drawn[0].clone.hasAttribute('data-share')).toBe(true)
		expect(drawn[0].clone.textContent).not.toContain('山田太郎')
	})

	it('fetches no cover for an event without one', async () => {
		const face = await liveFace(ticket())
		const { env, drawn } = fakeEnv()

		await new ShareImage(env).share(face, '')

		expect(env.fetchCover).not.toHaveBeenCalled()
		expect(drawn[0].cover).toBeNull()
	})

	it('reports a closed share sheet as cancelled, and rethrows other failures', async () => {
		const face = await liveFace(ticket())
		const { env } = fakeEnv()
		env.navigator.share.mockRejectedValueOnce(
			new DOMException('closed', 'AbortError'),
		)
		expect(await new ShareImage(env).share(face, COVER_URL)).toBe('cancelled')

		env.navigator.share.mockRejectedValueOnce(
			new DOMException('no', 'NotAllowedError'),
		)
		await expect(new ShareImage(env).share(face, COVER_URL)).rejects.toThrow(
			'no',
		)
	})
})
