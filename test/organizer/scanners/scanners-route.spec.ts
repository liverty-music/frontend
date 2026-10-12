import { createFixture } from '@aurelia/testing'
import {
	type Scanner,
	ScannerSchema,
	ScannerStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/scanner_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthoredSeries } from '../../../organizer/services/series-client'
import { IAppConfig } from '../../../shared/config/app-config'
import { authoredSeries } from '../authored-series'

const ISeriesClient = DI.createInterface('ISeriesClient')
const IScannerClient = DI.createInterface('IScannerClient')
vi.mock('../../../organizer/services/series-client', () => ({
	ISeriesClient,
}))
vi.mock('../../../organizer/services/scanner-client', () => ({
	IScannerClient,
}))

const { ScannersRoute, staffGuideUrl, scannerUrl } = await import(
	'../../../organizer/scanners/scanners-route'
)

const EVENT_ID = '019a0000-0000-7000-8000-0000000000e1'
const SERIES_ID = '019a0000-0000-7000-8000-0000000000s1'

/**
 * A concert with the one event of this screen. `publishState` is the event's
 * own state; the Series' derived state is `seriesState`, which defaults to it.
 */
function concert(
	publishState: PublishState,
	opts: { startTime?: Date; openTime?: Date; seriesState?: PublishState } = {},
): AuthoredSeries {
	return authoredSeries({
		series: {
			id: { value: SERIES_ID },
			title: { value: 'Basement Night' },
			publishState: opts.seriesState ?? publishState,
		},
		events: [
			{
				id: { value: EVENT_ID },
				publishState,
				localDate: { value: { year: 2026, month: 11, day: 20 } },
				...(opts.startTime
					? { startTime: { value: timestampFromDate(opts.startTime) } }
					: {}),
				...(opts.openTime
					? { openTime: { value: timestampFromDate(opts.openTime) } }
					: {}),
			},
		],
	})
}

/** 18:00 JST start, 17:30 JST doors. */
const START = new Date('2026-11-20T09:00:00Z')
const DOORS = new Date('2026-11-20T08:30:00Z')

function scanner(
	number: number,
	status: ScannerStatus,
	extra: Partial<{ linkToken: string; bindTime: Date; revokeTime: Date }> = {},
): Scanner {
	return create(ScannerSchema, {
		id: { value: `scanner-${number}` },
		eventId: { value: EVENT_ID },
		number: { value: number },
		status,
		...(extra.linkToken ? { linkToken: { value: extra.linkToken } } : {}),
		...(extra.bindTime ? { bindTime: timestampFromDate(extra.bindTime) } : {}),
		...(extra.revokeTime
			? { revokeTime: timestampFromDate(extra.revokeTime) }
			: {}),
	})
}

const tokenOf = (n: number) => `token${n}`.padEnd(43, 'x')

interface Mocks {
	concerts: { list: ReturnType<typeof vi.fn> }
	scanners: {
		listByEvent: ReturnType<typeof vi.fn>
		create: ReturnType<typeof vi.fn>
		revoke: ReturnType<typeof vi.fn>
	}
}

function mocks(c: AuthoredSeries, scanners: Scanner[] = []): Mocks {
	return {
		concerts: { list: vi.fn().mockResolvedValue([c]) },
		scanners: {
			listByEvent: vi.fn().mockResolvedValue(scanners),
			create: vi.fn(),
			revoke: vi.fn(),
		},
	}
}

async function build(m: Mocks) {
	const fixture = createFixture
		.html('<scanners-route component.ref="route"></scanners-route>')
		.deps(
			ScannersRoute,
			Registration.instance(ISeriesClient, m.concerts),
			Registration.instance(IScannerClient, m.scanners),
			Registration.instance(IAppConfig, { receptionBaseUrl: RECEPTION }),
		)
		.build()
	await fixture.started
	const route = (
		fixture.component as { route: InstanceType<typeof ScannersRoute> }
	).route
	route.canLoad({ eventId: EVENT_ID })
	await route.load()
	const text = () => fixture.appHost.textContent ?? ''
	const cards = () =>
		Array.from(fixture.appHost.querySelectorAll('.scanner-card')).map(
			(el) => el.textContent ?? '',
		)
	const buttons = () =>
		Array.from(fixture.appHost.querySelectorAll('button')).map((b) =>
			(b.textContent ?? '').trim(),
		)
	return { fixture, route, text, cards, buttons }
}

/** The reception app's origin from the organizer config, not the console's. */
const RECEPTION = 'https://reception.liverty-music.app'

describe('ScannersRoute', () => {
	beforeEach(() => vi.clearAllMocks())

	it('lists created scanners as unused, each with a link URL to copy', async () => {
		// @spec components/infrastructure/organizer/web/route/scanners "Create two scanners"
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }))
		m.scanners.create
			.mockResolvedValueOnce(
				scanner(1, ScannerStatus.UNUSED, { linkToken: tokenOf(1) }),
			)
			.mockResolvedValueOnce(
				scanner(2, ScannerStatus.UNUSED, { linkToken: tokenOf(2) }),
			)
		const { route, cards, fixture } = await build(m)
		expect(route.rows).toHaveLength(0)

		await route.create()
		await route.create()

		// One action each; nothing but the event is asked for.
		expect(m.scanners.create).toHaveBeenNthCalledWith(1, EVENT_ID)
		expect(m.scanners.create).toHaveBeenNthCalledWith(2, EVENT_ID)
		const [first, second] = cards()
		expect(first).toContain('受付1')
		expect(first).toContain('未使用')
		expect(second).toContain('受付2')
		expect(second).toContain('未使用')
		const urls = Array.from(
			fixture.appHost.querySelectorAll<HTMLInputElement>('.scanner-card input'),
		).map((i) => i.value)
		expect(urls).toEqual([
			`${RECEPTION}/#${tokenOf(1)}`,
			`${RECEPTION}/#${tokenOf(2)}`,
		])
		expect(
			fixture.appHost.querySelectorAll('.scanner-card button').length,
		).toBeGreaterThan(0)
		expect(cards().every((c) => c.includes('URLをコピー'))).toBe(true)

		// Copy puts the URL on the clipboard.
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText },
			configurable: true,
		})
		await route.copy(route.rows[0])
		expect(writeText).toHaveBeenCalledWith(`${RECEPTION}/#${tokenOf(1)}`)
		expect(route.copiedId).toBe('scanner-1')
	})

	it('shows a scanner whose link was opened as in use since then, without its URL', async () => {
		// @spec components/infrastructure/organizer/web/route/scanners "Link opened by staff"
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }), [
			// 14:10 JST.
			scanner(1, ScannerStatus.IN_USE, {
				bindTime: new Date('2026-11-20T05:10:00Z'),
			}),
			scanner(2, ScannerStatus.UNUSED, { linkToken: tokenOf(2) }),
		])
		const { cards, fixture } = await build(m)
		const [first, second] = cards()
		expect(first).toContain('受付1')
		expect(first).toContain('使用中')
		expect(first).toContain('14:10')
		expect(first).not.toContain(RECEPTION)
		expect(
			fixture.appHost
				.querySelectorAll('.scanner-card')[0]
				.querySelector('input'),
		).toBeNull()
		expect(second).toContain('未使用')
	})

	it('revokes and reissues after confirmation, showing the new scanner', async () => {
		// @spec components/infrastructure/organizer/web/route/scanners "Staff changed phones"
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }), [
			scanner(1, ScannerStatus.IN_USE, {
				bindTime: new Date('2026-11-20T05:10:00Z'),
			}),
			scanner(2, ScannerStatus.UNUSED, { linkToken: tokenOf(2) }),
		])
		m.scanners.revoke.mockResolvedValue(
			scanner(1, ScannerStatus.REVOKED, {
				bindTime: new Date('2026-11-20T05:10:00Z'),
				revokeTime: new Date('2026-11-20T10:10:00Z'),
			}),
		)
		m.scanners.create.mockResolvedValue(
			scanner(3, ScannerStatus.UNUSED, { linkToken: tokenOf(3) }),
		)
		const { route, cards, text } = await build(m)

		// Asking first changes nothing; the page itself asks for confirmation.
		route.askConfirm(route.rows[0], 'reissue')
		expect(m.scanners.revoke).not.toHaveBeenCalled()
		expect(text()).toContain('受付1 を取り消して、新しい受付リンクを発行します')

		await route.confirm()
		expect(m.scanners.revoke).toHaveBeenCalledWith('scanner-1')
		expect(m.scanners.create).toHaveBeenCalledWith(EVENT_ID)
		const [first, , third] = cards()
		expect(first).toContain('受付1')
		expect(first).toContain('取り消し済み')
		expect(third).toContain('受付3')
		expect(third).toContain('未使用')
		expect(route.rows[2].url).toBe(`${RECEPTION}/#${tokenOf(3)}`)
		expect(route.createdId).toBe('scanner-3')
	})

	it('revokes only after confirmation, and dismissing keeps the scanner', async () => {
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }), [
			scanner(1, ScannerStatus.UNUSED, { linkToken: tokenOf(1) }),
		])
		m.scanners.revoke.mockResolvedValue(scanner(1, ScannerStatus.REVOKED))
		const { route } = await build(m)

		route.askConfirm(route.rows[0], 'revoke')
		route.dismissConfirm()
		await route.confirm()
		expect(m.scanners.revoke).not.toHaveBeenCalled()

		route.askConfirm(route.rows[0], 'revoke')
		await route.confirm()
		expect(m.scanners.revoke).toHaveBeenCalledWith('scanner-1')
		expect(m.scanners.create).not.toHaveBeenCalled()
		expect(route.rows[0].statusLabel).toBe('取り消し済み')
		expect(route.rows[0].url).toBe('')
		expect(route.rows[0].canRevoke).toBe(false)
	})

	it('says a draft event must be published first', async () => {
		// @spec components/infrastructure/organizer/web/route/scanners "Unpublished event"
		const m = mocks(concert(PublishState.DRAFT, { startTime: START }))
		const { route, text, buttons } = await build(m)
		expect(route.createBlock).toBe('draft')
		expect(text()).toContain('先に公演を公開してください')
		expect(buttons()).not.toContain('受付リンクを発行')
		await route.create()
		expect(m.scanners.create).not.toHaveBeenCalled()
	})

	it('reads the draft date of a published concert as a draft', async () => {
		// @spec components/infrastructure/organizer/web/route/scanners "Unpublished event"
		const m = mocks(
			concert(PublishState.DRAFT, {
				startTime: START,
				seriesState: PublishState.PUBLISHED,
			}),
		)
		const { route, text, buttons } = await build(m)
		expect(route.createBlock).toBe('draft')
		expect(text()).toContain('先に公演を公開してください')
		expect(buttons()).not.toContain('受付リンクを発行')
	})

	it('reads the cancelled date of a published concert as cancelled', async () => {
		const m = mocks(
			concert(PublishState.CANCELLED, {
				startTime: START,
				seriesState: PublishState.PUBLISHED,
			}),
		)
		const { route, buttons } = await build(m)
		expect(route.createBlock).toBe('cancelled')
		expect(buttons()).not.toContain('受付リンクを発行')
		await route.create()
		expect(m.scanners.create).not.toHaveBeenCalled()
	})

	it('says an event without a start time needs one first', async () => {
		// @spec components/infrastructure/organizer/web/route/scanners "Event without a start time"
		const m = mocks(concert(PublishState.PUBLISHED))
		const { route, text, buttons } = await build(m)
		expect(route.createBlock).toBe('no-start-time')
		expect(text()).toContain('公演の開始時刻を設定してください')
		expect(buttons()).not.toContain('受付リンクを発行')
		await route.create()
		expect(m.scanners.create).not.toHaveBeenCalled()
	})

	it('shows the admission window and that a scanner works on its first device only', async () => {
		const m = mocks(
			concert(PublishState.PUBLISHED, { startTime: START, openTime: DOORS }),
		)
		const { text } = await build(m)
		// Doors 17:30 → from 14:30; until 04:00 the next day.
		expect(text()).toContain('2026-11-20 14:30 〜 2026-11-21 04:00')
		expect(text()).toContain('最初に開いた端末でだけ使えます')
	})

	it('surfaces a failed create', async () => {
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }))
		m.scanners.create.mockRejectedValue(
			new ConnectError('no', Code.FailedPrecondition),
		)
		const { route, text } = await build(m)
		await route.create()
		expect(route.busy).toBe(false)
		expect(text()).toContain('受付リンクを発行できません')
	})

	it('reports an event that is not among the operator’s concerts', async () => {
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }))
		m.concerts.list.mockResolvedValue([])
		const { route } = await build(m)
		expect(route.phase).toBe('not-found')
		expect(m.scanners.listByEvent).not.toHaveBeenCalled()
	})

	it('builds the scanner URL on the reception origin with the link token in the fragment', () => {
		expect(scannerUrl('https://reception.example', 'abc')).toBe(
			'https://reception.example/#abc',
		)
	})

	it('links the staff guide on the reception origin, opened in a new tab', async () => {
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }))
		const { fixture } = await build(m)

		const guide = fixture.appHost.querySelector<HTMLAnchorElement>(
			'a[href$="/guide.html"]',
		)
		expect(guide).not.toBeNull()
		expect(guide?.getAttribute('href')).toBe(`${RECEPTION}/guide.html`)
		expect(guide?.getAttribute('target')).toBe('_blank')
		expect(guide?.getAttribute('rel')).toContain('noopener')
		expect(guide?.textContent).toContain('受付スタッフ向けの使い方')
		expect(staffGuideUrl('https://reception.example')).toBe(
			'https://reception.example/guide.html',
		)
	})
})
