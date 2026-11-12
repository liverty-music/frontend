import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { OrganizerSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { PayoutOnboardingStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/payout_account_pb.js'
import {
	ScannerSchema,
	ScannerStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/scanner_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeRoute } from '../../../organizer/home/home-route'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import { IArtistClient } from '../../../organizer/services/artist-client'
import { IClock } from '../../../organizer/services/clock'
import { IOrganizerClient } from '../../../organizer/services/organizer-client'
import { IPayoutAccountClient } from '../../../organizer/services/payout-account-client'
import { IScannerClient } from '../../../organizer/services/scanner-client'
import { ISeriesClient } from '../../../organizer/services/series-client'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { ConsoleButton } from '../../../organizer/ui/console-button/console-button'
import { ConsoleIcon } from '../../../organizer/ui/console-icon/console-icon'
import { ListItem } from '../../../organizer/ui/list-item/list-item'
import { authoredSeries } from '../authored-series'

const SPEC = 'components/infrastructure/organizer/web/route/home'

/** Wednesday 28 October 2026, 10:00 JST: XX Tour's 3 November date is next week. */
const NOW = new Date('2026-10-28T10:00:00+09:00').getTime()

const BAND_A = { id: { value: 'a-1' }, name: { value: 'Band A' } }

const at = (day: string) => timestampFromDate(new Date(`${day}T18:00:00+09:00`))

/** XX Tour 2026: published dates on 3 and 10 November, both with a start time. */
const XX_TOUR = authoredSeries({
	series: { id: { value: 's-tour' }, title: { value: 'XX Tour 2026' } },
	performers: [BAND_A],
	events: [
		{
			id: { value: 'e-1103' },
			localDate: { value: { year: 2026, month: 11, day: 3 } },
			startTime: { value: at('2026-11-03') },
			publishState: PublishState.PUBLISHED,
		},
		{
			id: { value: 'e-1110' },
			localDate: { value: { year: 2026, month: 11, day: 10 } },
			startTime: { value: at('2026-11-10') },
			publishState: PublishState.PUBLISHED,
		},
	],
})

/** XX 単独公演: one draft date on 20 December. */
const XX_SOLO = authoredSeries({
	series: { id: { value: 's-solo' }, title: { value: 'XX 単独公演' } },
	performers: [BAND_A],
	events: [
		{
			id: { value: 'e-1220' },
			localDate: { value: { year: 2026, month: 12, day: 20 } },
			startTime: { value: at('2026-12-20') },
			publishState: PublishState.DRAFT,
		},
	],
})

interface Setup {
	concerts?: ReturnType<typeof authoredSeries>[]
	/** The payout account status; `null` for no account, an Error for a failed read. */
	payout?: PayoutOnboardingStatus | null | Error
	scanners?: ReturnType<typeof scanner>[]
	now?: number
}

const scanner = (status: ScannerStatus) =>
	create(ScannerSchema, { id: { value: 'sc-1' }, status })

/** The text of a node, reading through the shadow roots of console components. */
function textOf(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
	const el = node as Element
	// A slot shows what was assigned to it, as the member reads it.
	if (el instanceof HTMLSlotElement) {
		return el
			.assignedNodes({ flatten: true })
			.map((assigned) => textOf(assigned))
			.join('')
	}
	const children = el.shadowRoot?.childNodes ?? el.childNodes
	return [...children].map((child) => textOf(child)).join('')
}

/** The text of a node as a member reads it, whitespace collapsed. */
const read = (node: Node) => textOf(node).replace(/\s+/g, ' ').trim()

async function mount(setup: Setup = {}) {
	const payout =
		setup.payout === undefined ? PayoutOnboardingStatus.ACTIVE : setup.payout
	const clients = {
		series: { list: vi.fn().mockResolvedValue(setup.concerts ?? []) },
		payout: {
			get: vi.fn(async () => {
				if (payout instanceof Error) throw payout
				return payout === null ? null : { status: payout }
			}),
		},
		scanners: {
			listByEvent: vi.fn().mockResolvedValue(setup.scanners ?? []),
		},
	}
	const fixture = createFixture('<home-route></home-route>', class {}, [
		ConsoleI18nConfiguration,
		...ConsoleFormatters,
		ConsoleButton,
		ConsoleIcon,
		ListItem,
		HomeRoute,
		Registration.instance(IClock, { now: () => setup.now ?? NOW }),
		Registration.instance(ISeriesClient, clients.series),
		Registration.instance(IPayoutAccountClient, clients.payout),
		Registration.instance(IScannerClient, clients.scanners),
		Registration.instance(IOrganizerClient, {
			get: vi.fn().mockResolvedValue(
				create(OrganizerSchema, {
					id: { value: 'org-1' },
					name: { value: 'XX Records' },
				}),
			),
		}),
		Registration.instance(IArtistClient, {
			list: vi.fn().mockResolvedValue([create(ArtistSchema, BAND_A)]),
		}),
	])
	await fixture.container.get(IConsoleContext).load()
	await fixture.startPromise
	await tasksSettled()
	const host = fixture.appHost.querySelector('home-route') as HTMLElement
	/** The list items of the whole page, in order. */
	const items = () => [...host.querySelectorAll('li')]
	/** The items under one subheader (要対応, 7日以内, 開始時刻なし, 下書き). */
	const group = (subheader: string) => {
		const h2 = [...host.querySelectorAll('h2')].find(
			(h) => h.textContent?.trim() === subheader,
		)
		return [...(h2?.parentElement?.querySelectorAll('li') ?? [])]
	}
	/** An item is one link, with no button or other control inside it. */
	const actionOf = (item: Element): HTMLAnchorElement => {
		const list = item.querySelector('list-item')?.shadowRoot
		expect(list?.querySelectorAll('a')).toHaveLength(1)
		expect(item.querySelectorAll('button, console-button')).toHaveLength(0)
		return list?.querySelector('a') as HTMLAnchorElement
	}
	const done = async () => {
		await tasksSettled()
		await fixture.tearDown()
	}
	return { host, items, group, actionOf, clients, done }
}

describe('home route', () => {
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it(`@spec ${SPEC} "Payout account not finished"`, async () => {
		const { host, items, group, actionOf, done } = await mount({
			payout: PayoutOnboardingStatus.PENDING,
			concerts: [XX_TOUR, XX_SOLO],
		})

		const first = items()[0]
		expect(group('要対応')).toHaveLength(1)
		expect(read(first)).toContain('入金口座の登録が終わっていません')
		const action = actionOf(first)
		expect(read(action)).toBe('入金口座の登録が終わっていません 登録する')
		expect(action.getAttribute('href')).toMatch(/\/settings#payout$/)
		// The scanner item and the draft concert follow, under their subheaders.
		expect(items()).toHaveLength(3)
		expect(
			[...host.querySelectorAll('h2')].map((h) => h.textContent?.trim()),
		).toEqual(['要対応', '7日以内', '下書き'])
		expect(read(group('7日以内')[0])).toContain('受付リンクなし')
		expect(read(group('下書き')[0])).toContain('XX 単独公演')
		await done()
	})

	it(`@spec ${SPEC} "No payout account yet"`, async () => {
		const { host, items, actionOf, done } = await mount({
			payout: null,
			concerts: [XX_SOLO],
		})

		const first = items()[0]
		expect(read(first)).toContain('入金口座の登録が終わっていません')
		const action = actionOf(first)
		expect(read(action)).toBe('入金口座の登録が終わっていません 登録する')
		expect(action.getAttribute('href')).toMatch(/\/settings#payout$/)
		expect(read(host)).not.toContain('入金口座の状況を読み込めませんでした。')
		await done()
	})

	it(`@spec ${SPEC} "Event next week without a scanner"`, async () => {
		const { group, actionOf, clients, done } = await mount({
			concerts: [XX_TOUR],
		})

		const [item, ...rest] = group('7日以内')
		expect(rest).toHaveLength(0)
		expect(read(item)).toContain('11月3日(火) 18:00 JST · 受付リンクなし')
		expect(read(item)).toContain('XX Tour 2026')
		const action = actionOf(item)
		expect(read(item)).toContain('発行する')
		expect(clients.scanners.listByEvent).toHaveBeenCalledWith(
			'e-1103',
			expect.anything(),
		)
		// Selecting it opens the event's scanners page.
		expect(action.getAttribute('href')).toBe(
			'/organizers/org-1/artists/a-1/series/s-tour/events/e-1103/scanners',
		)
		await done()
	})

	it(`@spec ${SPEC} "Revoked scanners only"`, async () => {
		const { group, done } = await mount({
			concerts: [XX_TOUR],
			scanners: [scanner(ScannerStatus.REVOKED)],
		})

		const item = group('7日以内')[0]
		expect(read(item)).toContain('11月3日(火) 18:00 JST · 受付リンクなし')
		expect(
			item
				.querySelector('list-item')
				?.shadowRoot?.querySelector('a')
				?.getAttribute('href'),
		).toMatch(/\/series\/s-tour\/events\/e-1103\/scanners$/)
		expect(read(item)).toContain('発行する')
		await done()
	})

	it(`@spec ${SPEC} "Published event without a start time"`, async () => {
		const tour = authoredSeries({
			series: { id: { value: 's-tour' }, title: { value: 'XX Tour 2026' } },
			performers: [BAND_A],
			events: [
				...XX_TOUR.events,
				{
					id: { value: 'e-1220' },
					localDate: { value: { year: 2026, month: 12, day: 20 } },
					publishState: PublishState.PUBLISHED,
				},
			],
		})
		const { items, group, actionOf, done } = await mount({
			concerts: [tour],
			// The event next week has a scanner, so only the start time is missing.
			scanners: [scanner(ScannerStatus.UNUSED)],
		})

		expect(items()).toHaveLength(1)
		const item = group('開始時刻なし')[0]
		expect(read(item)).toContain('XX Tour 2026')
		expect(read(item)).toContain('12月20日(日)')
		expect(read(item)).toContain('開始時刻が未設定です')
		const action = actionOf(item)
		expect(read(item)).toContain('設定する')
		// The action opens XX Tour 2026's concert editor.
		expect(action.getAttribute('href')).toMatch(/\/series\/s-tour\/edit$/)
		await done()
	})

	it(`@spec ${SPEC} "Draft concert"`, async () => {
		const { items, group, actionOf, done } = await mount({
			concerts: [XX_SOLO],
		})

		expect(items()).toHaveLength(1)
		const action = actionOf(group('下書き')[0])
		expect(read(action)).toBe('XX 単独公演 12月20日(日)')
		expect(action.getAttribute('href')).toMatch(/\/series\/s-solo$/)
		await done()
	})

	it(`@spec ${SPEC} "All clear"`, async () => {
		// Two weeks before the tour: no event within 7 days, nothing in draft.
		const { host, done } = await mount({
			concerts: [XX_TOUR],
			now: new Date('2026-10-13T10:00:00+09:00').getTime(),
		})

		expect(read(host)).toContain('いま対応が必要なことはありません。')
		expect(host.querySelector('[data-testid="home-items"]')).toBeNull()
		const link = host
			.querySelector('.all-clear console-button')
			?.shadowRoot?.querySelector('a')
		expect(read(link as Node)).toBe('公演一覧へ')
		expect(link?.getAttribute('href')).toMatch(/\/series$/)
		await done()
	})

	it(`@spec ${SPEC} "Payout status unavailable"`, async () => {
		const { host, group, clients, done } = await mount({
			concerts: [XX_SOLO],
			payout: new ConnectError('payout provider down', Code.Unavailable),
		})

		expect(read(group('下書き')[0])).toContain('XX 単独公演')
		const alert = host.querySelector('[role="alert"]') as HTMLElement
		expect(read(alert)).toContain('入金口座の状況を読み込めませんでした。')
		// It is not claimed that nothing needs attention.
		expect(read(host)).not.toContain('いま対応が必要なことはありません。')

		const before = clients.payout.get.mock.calls.length
		alert
			.querySelector('console-button')
			?.shadowRoot?.querySelector('button')
			?.click()
		await tasksSettled()
		expect(clients.payout.get.mock.calls.length).toBeGreaterThan(before)
		await done()
	})

	it(`@spec components/infrastructure/organizer/web/route/settings "Back from onboarding"`, async () => {
		// Stripe brings the member back to the console, which opens Home and reads
		// the payout account again: still pending -> the item, active -> none.
		const pending = await mount({ payout: PayoutOnboardingStatus.PENDING })
		expect(
			pending
				.items()
				.filter((i) => read(i).includes('入金口座の登録が終わっていません')),
		).toHaveLength(1)
		expect(pending.clients.payout.get).toHaveBeenCalled()
		await pending.done()

		const active = await mount({ payout: PayoutOnboardingStatus.ACTIVE })
		expect(active.clients.payout.get).toHaveBeenCalled()
		expect(
			active
				.items()
				.filter((i) => read(i).includes('入金口座の登録が終わっていません')),
		).toHaveLength(0)
		await active.done()
	})
})
