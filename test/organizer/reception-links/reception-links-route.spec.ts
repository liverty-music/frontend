import { createFixture } from '@aurelia/testing'
import {
	type ReceptionLink,
	ReceptionLinkSchema,
	ReceptionLinkStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/reception_link_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import {
	type AuthoredConcert,
	AuthoredConcertSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/concert/v1/concert_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IAppConfig } from '../../../shared/config/app-config'

const IConcertAuthoringClient = DI.createInterface('IConcertAuthoringClient')
const IReceptionLinkClient = DI.createInterface('IReceptionLinkClient')
vi.mock('../../../organizer/services/concert-authoring-client', () => ({
	IConcertAuthoringClient,
}))
vi.mock('../../../organizer/services/reception-link-client', () => ({
	IReceptionLinkClient,
}))

const { ReceptionLinksRoute, receptionGuideUrl, receptionUrl } = await import(
	'../../../organizer/reception-links/reception-links-route'
)

const EVENT_ID = '019a0000-0000-7000-8000-0000000000e1'
const SERIES_ID = '019a0000-0000-7000-8000-0000000000s1'

function concert(
	publishState: PublishState,
	opts: { startTime?: Date; openTime?: Date } = {},
): AuthoredConcert {
	return create(AuthoredConcertSchema, {
		series: {
			id: { value: SERIES_ID },
			title: { value: 'Basement Night' },
			publishState,
		},
		events: [
			{
				id: { value: EVENT_ID },
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

function link(
	number: number,
	status: ReceptionLinkStatus,
	extra: Partial<{ token: string; bindTime: Date; revokeTime: Date }> = {},
): ReceptionLink {
	return create(ReceptionLinkSchema, {
		id: { value: `link-${number}` },
		eventId: { value: EVENT_ID },
		number: { value: number },
		status,
		...(extra.token ? { token: { value: extra.token } } : {}),
		...(extra.bindTime ? { bindTime: timestampFromDate(extra.bindTime) } : {}),
		...(extra.revokeTime
			? { revokeTime: timestampFromDate(extra.revokeTime) }
			: {}),
	})
}

const tokenOf = (n: number) => `token${n}`.padEnd(43, 'x')

interface Mocks {
	concerts: { list: ReturnType<typeof vi.fn> }
	links: {
		list: ReturnType<typeof vi.fn>
		issue: ReturnType<typeof vi.fn>
		revoke: ReturnType<typeof vi.fn>
	}
}

function mocks(c: AuthoredConcert, links: ReceptionLink[] = []): Mocks {
	return {
		concerts: { list: vi.fn().mockResolvedValue([c]) },
		links: {
			list: vi.fn().mockResolvedValue(links),
			issue: vi.fn(),
			revoke: vi.fn(),
		},
	}
}

async function build(m: Mocks) {
	const fixture = createFixture
		.html(
			'<reception-links-route component.ref="route"></reception-links-route>',
		)
		.deps(
			ReceptionLinksRoute,
			Registration.instance(IConcertAuthoringClient, m.concerts),
			Registration.instance(IReceptionLinkClient, m.links),
			Registration.instance(IAppConfig, { receptionBaseUrl: RECEPTION }),
		)
		.build()
	await fixture.started
	const route = (
		fixture.component as { route: InstanceType<typeof ReceptionLinksRoute> }
	).route
	route.canLoad({ eventId: EVENT_ID })
	await route.load()
	const text = () => fixture.appHost.textContent ?? ''
	const cards = () =>
		Array.from(fixture.appHost.querySelectorAll('.link-card')).map(
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

describe('ReceptionLinksRoute', () => {
	beforeEach(() => vi.clearAllMocks())

	it('lists issued links as unused, each with a URL to copy', async () => {
		// @spec components/infrastructure/organizer/web/route/reception-links "Issue two links"
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }))
		m.links.issue
			.mockResolvedValueOnce(
				link(1, ReceptionLinkStatus.UNUSED, { token: tokenOf(1) }),
			)
			.mockResolvedValueOnce(
				link(2, ReceptionLinkStatus.UNUSED, { token: tokenOf(2) }),
			)
		const { route, cards, fixture } = await build(m)
		expect(route.rows).toHaveLength(0)

		await route.issue()
		await route.issue()

		// One action each; nothing but the event is asked for.
		expect(m.links.issue).toHaveBeenNthCalledWith(1, EVENT_ID)
		expect(m.links.issue).toHaveBeenNthCalledWith(2, EVENT_ID)
		const [first, second] = cards()
		expect(first).toContain('受付1')
		expect(first).toContain('未使用')
		expect(second).toContain('受付2')
		expect(second).toContain('未使用')
		const urls = Array.from(
			fixture.appHost.querySelectorAll<HTMLInputElement>('.link-card input'),
		).map((i) => i.value)
		expect(urls).toEqual([
			`${RECEPTION}/#${tokenOf(1)}`,
			`${RECEPTION}/#${tokenOf(2)}`,
		])
		expect(
			fixture.appHost.querySelectorAll('.link-card button').length,
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
		expect(route.copiedId).toBe('link-1')
	})

	it('shows an opened link as in use since it was opened, without its URL', async () => {
		// @spec components/infrastructure/organizer/web/route/reception-links "Link opened by staff"
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }), [
			// 14:10 JST.
			link(1, ReceptionLinkStatus.IN_USE, {
				bindTime: new Date('2026-11-20T05:10:00Z'),
			}),
			link(2, ReceptionLinkStatus.UNUSED, { token: tokenOf(2) }),
		])
		const { cards, fixture } = await build(m)
		const [first, second] = cards()
		expect(first).toContain('受付1')
		expect(first).toContain('使用中')
		expect(first).toContain('14:10')
		expect(first).not.toContain(RECEPTION)
		expect(
			fixture.appHost.querySelectorAll('.link-card')[0].querySelector('input'),
		).toBeNull()
		expect(second).toContain('未使用')
	})

	it('revokes and reissues after confirmation, showing the new link', async () => {
		// @spec components/infrastructure/organizer/web/route/reception-links "Staff changed phones"
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }), [
			link(1, ReceptionLinkStatus.IN_USE, {
				bindTime: new Date('2026-11-20T05:10:00Z'),
			}),
			link(2, ReceptionLinkStatus.UNUSED, { token: tokenOf(2) }),
		])
		m.links.revoke.mockResolvedValue(
			link(1, ReceptionLinkStatus.REVOKED, {
				bindTime: new Date('2026-11-20T05:10:00Z'),
				revokeTime: new Date('2026-11-20T10:10:00Z'),
			}),
		)
		m.links.issue.mockResolvedValue(
			link(3, ReceptionLinkStatus.UNUSED, { token: tokenOf(3) }),
		)
		const { route, cards, text } = await build(m)

		// Asking first changes nothing; the page itself asks for confirmation.
		route.askConfirm(route.rows[0], 'reissue')
		expect(m.links.revoke).not.toHaveBeenCalled()
		expect(text()).toContain('受付1 を取り消して、新しい受付リンクを発行します')

		await route.confirm()
		expect(m.links.revoke).toHaveBeenCalledWith('link-1')
		expect(m.links.issue).toHaveBeenCalledWith(EVENT_ID)
		const [first, , third] = cards()
		expect(first).toContain('受付1')
		expect(first).toContain('取り消し済み')
		expect(third).toContain('受付3')
		expect(third).toContain('未使用')
		expect(route.rows[2].url).toBe(`${RECEPTION}/#${tokenOf(3)}`)
		expect(route.issuedId).toBe('link-3')
	})

	it('revokes only after confirmation, and dismissing keeps the link', async () => {
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }), [
			link(1, ReceptionLinkStatus.UNUSED, { token: tokenOf(1) }),
		])
		m.links.revoke.mockResolvedValue(link(1, ReceptionLinkStatus.REVOKED))
		const { route } = await build(m)

		route.askConfirm(route.rows[0], 'revoke')
		route.dismissConfirm()
		await route.confirm()
		expect(m.links.revoke).not.toHaveBeenCalled()

		route.askConfirm(route.rows[0], 'revoke')
		await route.confirm()
		expect(m.links.revoke).toHaveBeenCalledWith('link-1')
		expect(m.links.issue).not.toHaveBeenCalled()
		expect(route.rows[0].statusLabel).toBe('取り消し済み')
		expect(route.rows[0].url).toBe('')
		expect(route.rows[0].canRevoke).toBe(false)
	})

	it('says a draft event must be published first', async () => {
		// @spec components/infrastructure/organizer/web/route/reception-links "Unpublished event"
		const m = mocks(concert(PublishState.DRAFT, { startTime: START }))
		const { route, text, buttons } = await build(m)
		expect(route.issueBlock).toBe('draft')
		expect(text()).toContain('先に公演を公開してください')
		expect(buttons()).not.toContain('受付リンクを発行')
		await route.issue()
		expect(m.links.issue).not.toHaveBeenCalled()
	})

	it('says an event without a start time needs one first', async () => {
		// @spec components/infrastructure/organizer/web/route/reception-links "Event without a start time"
		const m = mocks(concert(PublishState.PUBLISHED))
		const { route, text, buttons } = await build(m)
		expect(route.issueBlock).toBe('no-start-time')
		expect(text()).toContain('公演の開始時刻を設定してください')
		expect(buttons()).not.toContain('受付リンクを発行')
		await route.issue()
		expect(m.links.issue).not.toHaveBeenCalled()
	})

	it('shows the reception window and that a link works on its first device only', async () => {
		const m = mocks(
			concert(PublishState.PUBLISHED, { startTime: START, openTime: DOORS }),
		)
		const { text } = await build(m)
		// Doors 17:30 → from 14:30; until 04:00 the next day.
		expect(text()).toContain('2026-11-20 14:30 〜 2026-11-21 04:00')
		expect(text()).toContain('最初に開いた端末でだけ使えます')
	})

	it('surfaces a failed issue', async () => {
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }))
		m.links.issue.mockRejectedValue(
			new ConnectError('no', Code.FailedPrecondition),
		)
		const { route, text } = await build(m)
		await route.issue()
		expect(route.busy).toBe(false)
		expect(text()).toContain('受付リンクを発行できません')
	})

	it('reports an event that is not among the operator’s concerts', async () => {
		const m = mocks(concert(PublishState.PUBLISHED, { startTime: START }))
		m.concerts.list.mockResolvedValue([])
		const { route } = await build(m)
		expect(route.phase).toBe('not-found')
		expect(m.links.list).not.toHaveBeenCalled()
	})

	it('builds the reception URL on the reception origin with the token in the fragment', () => {
		expect(receptionUrl('https://reception.example', 'abc')).toBe(
			'https://reception.example/#abc',
		)
	})

	it('links the reception guide on the reception origin, opened in a new tab', async () => {
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
		expect(receptionGuideUrl('https://reception.example')).toBe(
			'https://reception.example/guide.html',
		)
	})
})
