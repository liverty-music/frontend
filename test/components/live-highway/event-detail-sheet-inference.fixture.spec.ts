import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Snack } from '../../../shared/ui/snack-bar/snack'
import { IHistory } from '../../../src/adapter/browser/history'
import { ITicketJourneyRpcClient } from '../../../src/adapter/rpc/client/ticket-journey-client'
import { EventDetailSheet } from '../../../src/components/live-highway/event-detail-sheet'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
import { SvgIcon } from '../../../src/components/svg-icon/svg-icon'
import type { JourneyStatus } from '../../../src/entities/concert'
import type { Hype } from '../../../src/entities/follow'
import { IAnalyticsService } from '../../../src/lib/analytics/analytics-service'
import ja from '../../../src/locales/ja/translation.json'
import { IAuthService } from '../../../src/services/auth-service'
import { IFollowStore } from '../../../src/services/follow-store'
import {
	ITicketJourneyStore,
	TicketJourneyStore,
} from '../../../src/services/ticket-journey-store'
import { DateValueConverter } from '../../../src/value-converters/date'
import { createMockAuth } from '../../helpers/mock-auth'
import { createMockHistory } from '../../helpers/mock-history'

/**
 * The event detail sheet's inferences, rendered from its real template with the
 * Japanese bundle: a calendar add starts tracking (with an undo snack on the
 * fan's return), and a saved journey that raised the artist's hype level shows
 * the raise with undo. The journey store is the real one over a mocked RPC
 * client, so the sheet and the Dashboard read the same map; the follow store is
 * a fake that answers the re-read the way the server would.
 */
const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<au-slot></au-slot>',
		bindables: ['open', 'dismissable', 'ariaLabel'],
	},
	class {},
)

function concert(overrides: Partial<LiveEvent> = {}): LiveEvent {
	return {
		id: 'ev-1',
		artistName: 'ヨルシカ',
		artistId: 'a1',
		venueName: 'Zepp Fukuoka',
		locationLabel: '福岡県',
		date: new Date(2026, 10, 20),
		startTime: '19:00',
		openTime: '18:00',
		title: 'ONE MAN LIVE',
		sourceUrl: 'https://example.com/live',
		isFirstParty: false,
		hypeLevel: 'nearby',
		matched: false,
		artistHue: 0,
		...overrides,
	}
}

/**
 * A follow store whose re-read answers with the server's level: `before` until
 * the journey is saved (the read just before the save), then `serverLevel()`.
 * `before` defaults to the session's cached level.
 */
function fakeFollowStore(
	initial: Hype,
	serverLevel: () => Hype,
	before: Hype = initial,
) {
	let reads = 0
	const store = {
		followedIds: new Set(['a1']),
		follow: vi.fn(),
		hypeByArtist: new Map<string, Hype>([['a1', initial]]) as ReadonlyMap<
			string,
			Hype
		>,
		rereadHype: vi.fn(async (artistId: string) => {
			reads += 1
			const level = reads === 1 ? before : serverLevel()
			store.hypeByArtist = new Map([[artistId, level]])
			return level
		}),
		setHype: vi.fn(async (artistId: string, hype: Hype) => {
			store.hypeByArtist = new Map([[artistId, hype]])
		}),
	}
	return store
}

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(state: DocumentVisibilityState): void {
	visibility = state
	document.dispatchEvent(new Event('visibilitychange'))
}

async function render({
	ev = concert(),
	signedIn = true,
	journeys = new Map<string, JourneyStatus>(),
	followStore = fakeFollowStore('nearby', () => 'nearby'),
	started = true,
}: {
	ev?: LiveEvent
	signedIn?: boolean
	journeys?: Map<string, JourneyStatus>
	followStore?: ReturnType<typeof fakeFollowStore>
	started?: boolean
} = {}) {
	const rpc = {
		list: vi.fn(async () => new Map(journeys)),
		setStatus: vi.fn(async () => undefined),
		delete: vi.fn(async () => undefined),
		inferTracking: vi.fn(async () => started),
	}
	const fixture = await createFixture(
		'<event-detail-sheet event.bind="ev" component.ref="sheet"></event-detail-sheet>',
		class Host {
			public ev = ev
			public sheet!: EventDetailSheet
		},
		[
			I18nConfiguration.customize((o) => {
				o.initOptions = { lng: 'ja', resources: { ja: { translation: ja } } }
			}),
			EventDetailSheet,
			BottomSheetStub,
			SvgIcon,
			DateValueConverter,
			Registration.instance(
				IAuthService,
				createMockAuth({ isAuthenticated: signedIn }),
			),
			Registration.instance(IHistory, createMockHistory()),
			Registration.instance(IFollowStore, followStore),
			Registration.instance(ITicketJourneyRpcClient, rpc),
			Registration.singleton(ITicketJourneyStore, TicketJourneyStore),
			Registration.instance(IAnalyticsService, { capture: vi.fn() }),
		],
	).started
	const journeyStore = fixture.container.get(ITicketJourneyStore)
	await journeyStore.load()
	const snacks: Snack[] = []
	fixture.container
		.get(IEventAggregator)
		.subscribe(Snack, (snack: Snack) => snacks.push(snack))
	await tasksSettled()
	const calendarLink = () => {
		const link = [
			...fixture.appHost.querySelectorAll<HTMLAnchorElement>(
				'.sheet-actions a',
			),
		].find((a) => a.textContent?.includes('カレンダーに追加'))
		if (!link) throw new Error('no calendar link')
		// jsdom would try to navigate the new tab; the sheet's listener runs first.
		link.addEventListener('click', (e) => e.preventDefault())
		return link
	}
	return {
		fixture,
		sheet: fixture.component.sheet,
		journeyStore,
		rpc,
		snacks,
		followStore,
		calendarLink,
	}
}

beforeEach(() => {
	visibility = 'visible'
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => visibility,
	})
})

afterEach(() => {
	Reflect.deleteProperty(document, 'visibilityState')
})

describe('adding to the calendar starts tracking', () => {
	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Calendar add from the sheet"
	// @spec stories/track-ticket-journey "Adding a concert to the calendar starts tracking it"
	it('starts tracking at once and shows the undo snack when the fan comes back', async () => {
		const { fixture, sheet, journeyStore, rpc, snacks, calendarLink } =
			await render()

		calendarLink().click()
		// The calendar hides the app; the journey is saved before the fan returns.
		setVisibility('hidden')
		await vi.waitFor(() =>
			expect(rpc.inferTracking).toHaveBeenCalledWith('ev-1', undefined),
		)
		await vi.waitFor(() => expect(sheet.status).toBe('tracking'))
		// The Dashboard reads the same store.
		expect(journeyStore.statusFor('ev-1')).toBe('tracking')
		expect(snacks).toEqual([])

		setVisibility('visible')
		await vi.waitFor(() => expect(snacks).toHaveLength(1))
		const [snack] = snacks
		expect(snack.message).toBe(
			'チケット状況を「追跡中」にしました。\n販売の情報をお知らせします。',
		)
		expect(snack.action?.label).toBe('取り消す')
		expect(snack.durationMs).toBe(10_000)
		await fixture.stop(true)
	})

	it('shows the snack at once when the app stayed in view', async () => {
		const { fixture, snacks, calendarLink } = await render()

		calendarLink().click()

		await vi.waitFor(() => expect(snacks).toHaveLength(1), { timeout: 3000 })
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Undo"
	// @spec stories/track-ticket-journey "Undo removes the inferred journey"
	it('removes the journey when the fan presses 取り消す', async () => {
		const { fixture, sheet, journeyStore, rpc, snacks, calendarLink } =
			await render()
		calendarLink().click()
		await vi.waitFor(() => expect(snacks).toHaveLength(1), { timeout: 3000 })

		snacks[0].action?.callback()

		await vi.waitFor(() =>
			expect(rpc.delete).toHaveBeenCalledWith('ev-1', undefined),
		)
		await vi.waitFor(() => expect(sheet.status).toBeUndefined())
		expect(journeyStore.statusFor('ev-1')).toBeUndefined()
		await fixture.stop(true)
	})

	it('still offers the undo when the calendar link is tapped twice', async () => {
		const { fixture, snacks, calendarLink } = await render()
		calendarLink().click()
		calendarLink().click()

		// The first tap started tracking; the second found the journey.
		await vi.waitFor(() => expect(snacks).toHaveLength(1), { timeout: 3000 })
		expect(snacks[0].action?.label).toBe('取り消す')
		await fixture.stop(true)
	})

	it('keeps a status the fan saved after the inference when 取り消す is pressed', async () => {
		const { fixture, sheet, journeyStore, rpc, snacks, calendarLink } =
			await render()
		calendarLink().click()
		await vi.waitFor(() => expect(snacks).toHaveLength(1), { timeout: 3000 })
		await sheet.setJourneyStatus('applied')

		snacks[0].action?.callback()

		await Promise.resolve()
		expect(rpc.delete).not.toHaveBeenCalled()
		expect(journeyStore.statusFor('ev-1')).toBe('applied')
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Fan already has a journey"
	// @spec stories/track-ticket-journey "Existing journey kept"
	it('requests nothing and shows no snack when the fan already has a journey', async () => {
		const { fixture, sheet, rpc, snacks, calendarLink } = await render({
			journeys: new Map([['ev-1', 'applied']]),
		})

		calendarLink().click()
		await new Promise((r) => setTimeout(r, 1200))

		expect(rpc.inferTracking).not.toHaveBeenCalled()
		expect(sheet.status).toBe('applied')
		expect(snacks).toEqual([])
		await fixture.stop(true)
	})

	it('shows no snack when the server started nothing', async () => {
		const { fixture, sheet, rpc, snacks, calendarLink } = await render({
			started: false,
		})

		calendarLink().click()
		await vi.waitFor(() => expect(rpc.inferTracking).toHaveBeenCalled())
		await new Promise((r) => setTimeout(r, 1200))

		expect(sheet.status).toBeUndefined()
		expect(snacks).toEqual([])
		await fixture.stop(true)
	})

	it('shows no snack when the save fails', async () => {
		const { fixture, sheet, rpc, snacks, calendarLink } = await render()
		rpc.inferTracking.mockRejectedValueOnce(new Error('unavailable'))

		calendarLink().click()
		await vi.waitFor(() => expect(rpc.inferTracking).toHaveBeenCalled())
		await new Promise((r) => setTimeout(r, 1200))

		expect(sheet.status).toBeUndefined()
		expect(snacks).toEqual([])
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Guest"
	it('requests nothing for a guest', async () => {
		const { fixture, rpc, snacks, calendarLink } = await render({
			signedIn: false,
		})

		calendarLink().click()
		await new Promise((r) => setTimeout(r, 1200))

		expect(rpc.inferTracking).not.toHaveBeenCalled()
		expect(snacks).toEqual([])
		await fixture.stop(true)
	})
})

describe('a hype level raised by a journey change is shown with undo', () => {
	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Applied for a distant concert raises the level"
	it('re-reads the level after Applied on an unmatched card and shows the raise', async () => {
		const followStore = fakeFollowStore('nearby', () => 'away')
		const { fixture, snacks } = await render({ followStore })

		await fixture.component.sheet.setJourneyStatus('applied')

		expect(followStore.rereadHype).toHaveBeenCalledWith('a1')
		expect(snacks).toHaveLength(1)
		const [snack] = snacks
		expect(snack.message).toBe(
			'ヨルシカを Away にしました。\n遠方の新着ライブも通知します。',
		)
		expect(snack.action?.label).toBe('取り消す')
		expect(snack.durationMs).toBe(10_000)
		// The new level is in the follow store the Dashboard re-derives from.
		expect(followStore.hypeByArtist.get('a1')).toBe('away')
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Undo the raise"
	it('saves the previous level as the fan own choice on 取り消す', async () => {
		const followStore = fakeFollowStore('nearby', () => 'away')
		const { fixture, snacks } = await render({ followStore })
		await fixture.component.sheet.setJourneyStatus('applied')

		snacks[0].action?.callback()

		await vi.waitFor(() =>
			expect(followStore.setHype).toHaveBeenCalledWith('a1', 'nearby'),
		)
		expect(followStore.hypeByArtist.get('a1')).toBe('nearby')
		await fixture.stop(true)
	})

	it('keeps a level the fan picked after the raise when 取り消す is pressed', async () => {
		const followStore = fakeFollowStore('nearby', () => 'away')
		const { fixture, snacks } = await render({ followStore })
		await fixture.component.sheet.setJourneyStatus('applied')
		// The fan picks Home on My Artists while the snack is still shown.
		await followStore.setHype('a1', 'home')
		followStore.setHype.mockClear()

		snacks[0].action?.callback()

		await Promise.resolve()
		expect(followStore.setHype).not.toHaveBeenCalled()
		expect(followStore.hypeByArtist.get('a1')).toBe('home')
		await fixture.stop(true)
	})

	it('takes a level set on another device for the fan own, not a raise', async () => {
		// The session still holds Nearby, but the fan set Away elsewhere.
		const followStore = fakeFollowStore('nearby', () => 'away', 'away')
		const { fixture, snacks } = await render({ followStore })

		await fixture.component.sheet.setJourneyStatus('applied')

		expect(snacks).toHaveLength(0)
		expect(followStore.setHype).not.toHaveBeenCalled()
		await fixture.stop(true)
	})

	it('keeps the raised level and says so when the undo fails', async () => {
		const followStore = fakeFollowStore('nearby', () => 'away')
		followStore.setHype.mockRejectedValueOnce(new Error('unavailable'))
		const { fixture, snacks } = await render({ followStore })
		await fixture.component.sheet.setJourneyStatus('applied')

		snacks[0].action?.callback()

		await vi.waitFor(() => expect(snacks).toHaveLength(2))
		expect(snacks[1].severity).toBe('error')
		expect(snacks[1].message).toBe(
			'取り消せませんでした。もう一度お試しください。',
		)
		expect(followStore.hypeByArtist.get('a1')).toBe('away')
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Level not raised"
	it('shows no snack when the level was not raised', async () => {
		const followStore = fakeFollowStore('home', () => 'home')
		const { fixture, snacks } = await render({ followStore })

		await fixture.component.sheet.setJourneyStatus('applied')

		expect(followStore.rereadHype).toHaveBeenCalled()
		expect(snacks).toEqual([])
		await fixture.stop(true)
	})

	it('does not re-read after Tracking, Lost, or on a card already matched', async () => {
		const followStore = fakeFollowStore('nearby', () => 'away')
		const { fixture, sheet } = await render({ followStore })

		await sheet.setJourneyStatus('tracking')
		await sheet.setJourneyStatus('lost')
		sheet.event = concert({ matched: true })
		await sheet.setJourneyStatus('paid')

		expect(followStore.rereadHype).not.toHaveBeenCalled()
		await fixture.stop(true)
	})
})
