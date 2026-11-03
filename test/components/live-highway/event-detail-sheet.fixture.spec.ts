import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { IHistory } from '../../../src/adapter/browser/history'
import { EventDetailSheet } from '../../../src/components/live-highway/event-detail-sheet'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
import { SvgIcon } from '../../../src/components/svg-icon/svg-icon'
import type { JourneyStatus } from '../../../src/entities/concert'
import { IAnalyticsService } from '../../../src/lib/analytics/analytics-service'
import ja from '../../../src/locales/ja/translation.json'
import { IAuthService } from '../../../src/services/auth-service'
import { IErrorBoundaryService } from '../../../src/services/error-boundary-service'
import { IFollowStore } from '../../../src/services/follow-store'
import {
	IPushOfferService,
	type PushState,
} from '../../../src/services/push-offer-service'
import { ITicketJourneyStore } from '../../../src/services/ticket-journey-store'
import { IUserStore } from '../../../src/services/user-store'
import { DateValueConverter } from '../../../src/value-converters/date'
import { createMockAuth } from '../../helpers/mock-auth'
import { createMockErrorBoundary } from '../../helpers/mock-error-boundary'
import { createMockHistory } from '../../helpers/mock-history'

/**
 * Renders the real detail-sheet template. The bottom sheet is a pass-through
 * stub (jsdom has no Popover API or IntersectionObserver); its own dismiss
 * behaviour is covered by the bottom-sheet specs.
 */
const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<au-slot></au-slot>',
		bindables: ['open', 'dismissable', 'ariaLabel'],
	},
	class {},
)

function event(overrides: Partial<LiveEvent> = {}): LiveEvent {
	return {
		id: 'ev-1',
		artistName: 'The Band',
		artistId: 'a1',
		venueName: 'Zepp Haneda',
		locationLabel: '東京都',
		date: new Date(2026, 10, 20),
		startTime: '19:00',
		openTime: '18:00',
		title: 'ONE MAN LIVE',
		sourceUrl: 'https://example.com/live',
		isFirstParty: false,
		hypeLevel: 'home',
		matched: true,
		artistHue: 0,
		...overrides,
	}
}

const analytics = { capture: vi.fn() }

interface RenderOptions {
	signedIn?: boolean
	status?: JourneyStatus
	push?: PushState
	/** The fan's hype level for the artist; absent means not followed. */
	hype?: 'watch' | 'home' | 'nearby' | 'away'
	/** Use the Japanese catalog instead of showing keys. */
	japanese?: boolean
	setHype?: (artistId: string, hype: string) => Promise<void>
}

/** Stores behind the sheet, read back by the tests. */
interface Harness {
	journey: Map<string, JourneyStatus>
	setStatus: ReturnType<typeof vi.fn>
	remove: ReturnType<typeof vi.fn>
	signUp: ReturnType<typeof vi.fn>
	accept: ReturnType<typeof vi.fn>
	setHype: ReturnType<typeof vi.fn>
	hypeByArtist: Map<string, string>
}

let harness: Harness

async function render(ev: LiveEvent, opts: RenderOptions = {}) {
	analytics.capture.mockClear()
	const journey = new Map<string, JourneyStatus>()
	if (opts.status) journey.set(ev.id, opts.status)
	const hypeByArtist = new Map<string, string>()
	if (opts.hype) hypeByArtist.set(ev.artistId, opts.hype)
	const auth = createMockAuth({ isAuthenticated: opts.signedIn ?? false })
	harness = {
		journey,
		setStatus: vi.fn(async (id: string, status: JourneyStatus) => {
			journey.set(id, status)
		}),
		remove: vi.fn(async (id: string) => {
			journey.delete(id)
		}),
		signUp: vi.fn(async () => {}),
		accept: vi.fn(async () => 'granted'),
		setHype: vi.fn(
			opts.setHype ??
				(async (artistId: string, hype: string) => {
					hypeByArtist.set(artistId, hype)
				}),
		),
		hypeByArtist,
	}
	;(auth as { signUp: unknown }).signUp = harness.signUp
	const fixture = await createFixture(
		'<event-detail-sheet event.bind="ev" component.ref="sheet"></event-detail-sheet>',
		class Host {
			public ev = ev
			public sheet!: EventDetailSheet
		},
		[
			I18nConfiguration.customize((o) => {
				o.initOptions = opts.japanese
					? { lng: 'ja', resources: { ja: { translation: ja } } }
					: { lng: 'en', resources: { en: { translation: {} } } }
			}),
			EventDetailSheet,
			BottomSheetStub,
			SvgIcon,
			DateValueConverter,
			Registration.instance(IAuthService, auth),
			Registration.instance(IErrorBoundaryService, createMockErrorBoundary()),
			Registration.instance(IHistory, createMockHistory()),
			Registration.instance(IFollowStore, {
				followedIds: new Set(opts.hype ? [ev.artistId] : []),
				hypeByArtist,
				follow: vi.fn(),
				setHype: harness.setHype,
				rereadHype: vi.fn(async () => undefined),
			}),
			Registration.instance(ITicketJourneyStore, {
				journeyMap: journey,
				// Read through `this`, as the real store does, so the sheet
				// observes the map.
				statusFor(
					this: { journeyMap: Map<string, JourneyStatus> },
					id?: string,
				) {
					return id ? this.journeyMap.get(id) : undefined
				},
				setStatus: harness.setStatus,
				delete: harness.remove,
			}),
			Registration.instance(IPushOfferService, {
				pushState: vi.fn(async () => opts.push ?? 'on'),
				accept: harness.accept,
			}),
			Registration.instance(IUserStore, { currentHome: 'JP-13' }),
			Registration.instance(IRouter, { load: vi.fn() }),
			Registration.instance(IAnalyticsService, analytics),
		],
	).started
	await tasksSettled()
	// The sheet reads the push state asynchronously when it attaches.
	await new Promise((r) => setTimeout(r))
	await tasksSettled()
	return fixture
}

describe('EventDetailSheet (fixture)', () => {
	it('shows the venue with its localized prefecture, and omits the line without one', async () => {
		// @spec components/infrastructure/fan/web/route/dashboard "Display venue information"
		const withArea = await render(event())
		const text = withArea.appHost.textContent ?? ''
		expect(text).toContain('Zepp Haneda')
		expect(text).toContain('東京都')
		expect(text).not.toContain('JP-13')
		await withArea.stop(true)

		const without = await render(event({ locationLabel: '' }))
		expect(
			[...without.appHost.querySelectorAll('.detail-secondary')].map((e) =>
				e.textContent?.trim(),
			),
		).not.toContain('')
		await without.stop(true)
	})

	it('links to Google Maps with the venue and area, labelled by its i18n key', async () => {
		// @spec components/infrastructure/fan/web/route/dashboard "Google Maps link"
		const fixture = await render(event())
		const link = fixture.appHost.querySelector(
			'a.detail-link[href*="google.com/maps"]',
		) as HTMLAnchorElement
		expect(link.href).toBe(
			`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Zepp Haneda 東京都')}`,
		)
		expect(link.textContent).toBe('eventDetail.openInGoogleMaps')
		await fixture.stop(true)
	})

	it('opens the official info page in a new tab, labelled by its i18n key', async () => {
		// @spec components/infrastructure/fan/web/route/dashboard "Ticket / official info link"
		const fixture = await render(event())
		const link = fixture.appHost.querySelector(
			'.sheet-tickets a.official-site',
		) as HTMLAnchorElement
		expect(link.href).toBe('https://example.com/live')
		expect(link.target).toBe('_blank')
		expect(link.textContent).toContain('eventDetail.viewOfficialInfo')
		await fixture.stop(true)
	})

	it('reports a tap on the source link and still follows it', async () => {
		// @spec components/infrastructure/fan/web/global/event-detail-sheet "Source link"
		const fixture = await render(event())
		const link = fixture.appHost.querySelector(
			'.sheet-tickets a.official-site',
		) as HTMLAnchorElement
		// jsdom would try to navigate; the listener runs before the default.
		link.addEventListener('click', (e) => {
			expect(e.defaultPrevented).toBe(false)
			e.preventDefault()
		})

		link.click()

		expect(analytics.capture).toHaveBeenCalledWith('concert.source.clicked', {
			event_id: event().id,
			artist_id: event().artistId,
		})
		await fixture.stop(true)
	})
})

/** The visible text of `selector`, trimmed. */
function textOf(root: Element, selector: string): string | undefined {
	return root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim()
}

async function press(root: Element, selector: string): Promise<void> {
	;(root.querySelector(selector) as HTMLButtonElement).click()
	await tasksSettled()
	await new Promise((r) => setTimeout(r))
	await tasksSettled()
}

const notify = '[data-testid="journey-notify-btn"]'
const statusButton = (status: JourneyStatus) =>
	`.journey-row [data-journey-status="${status}"]`

describe('EventDetailSheet ticket section (fixture)', () => {
	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Order of the sheet"
	// @spec components/infrastructure/fan/web/route/dashboard "Ticket / official info link"
	it('shows the date with the calendar link, the venue, then the ticket section ending with the official site button', async () => {
		const fixture = await render(event(), { signedIn: true, japanese: true })
		const root = fixture.appHost
		const order = [
			'.sheet-artist-header',
			'[data-testid="add-to-calendar"]',
			'.detail-row + .detail-row',
			'.sheet-tickets',
		].map((selector) => root.querySelector(selector))
		for (const [i, el] of order.entries()) {
			expect(el, `element ${i}`).not.toBeNull()
			if (i > 0) {
				expect(
					order[i - 1]?.compareDocumentPosition(el as Node) &
						Node.DOCUMENT_POSITION_FOLLOWING,
				).toBeTruthy()
			}
		}
		const tickets = root.querySelector('.sheet-tickets') as HTMLElement
		expect(tickets.lastElementChild?.matches('a.official-site')).toBe(true)
		expect(textOf(tickets, 'a.official-site')).toBe(
			'公式サイトでチケットを見る',
		)
		expect(
			root.querySelectorAll('a[href="https://example.com/live"]'),
		).toHaveLength(1)
		expect(root.querySelector('.sheet-actions')).toBeNull()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Back from the official site"
	it('keeps 申込済み in the row above the official site button', async () => {
		const fixture = await render(event(), { signedIn: true, status: 'applied' })
		const row = fixture.appHost.querySelector('.journey-row') as Element
		const official = fixture.appHost.querySelector('a.official-site') as Element
		expect(
			row.compareDocumentPosition(official) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
		expect(
			row.querySelector(statusButton('applied'))?.getAttribute('aria-pressed'),
		).toBe('true')
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Start tracking"
	// @spec components/infrastructure/fan/web/route/dashboard "Start tracking from detail view"
	it('starts tracking from the notification button', async () => {
		const fixture = await render(event(), { signedIn: true, japanese: true })
		const root = fixture.appHost
		expect(textOf(root, notify)).toBe('🔔 チケット販売の通知を受け取る')
		expect(root.querySelector(notify)?.getAttribute('data-emphasis')).toBe(
			'primary',
		)

		await press(root, notify)

		expect(harness.setStatus).toHaveBeenCalledWith('ev-1', 'tracking')
		expect(textOf(root, notify)).toBe('🔔 チケット販売の通知を受け取り中 ✓')
		expect(root.querySelector(notify)?.getAttribute('aria-pressed')).toBe(
			'true',
		)
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Stop tracking"
	// @spec components/infrastructure/fan/web/route/dashboard "Remove ticket journey from detail view"
	it('stops tracking when the selected notification button is pressed', async () => {
		const fixture = await render(event(), {
			signedIn: true,
			status: 'tracking',
		})

		await press(fixture.appHost, notify)

		expect(harness.remove).toHaveBeenCalledWith('ev-1')
		expect(harness.journey.has('ev-1')).toBe(false)
		expect(fixture.appHost.querySelector('.journey-remove')).toBeNull()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Applied in one tap"
	it('sets Applied in one tap from Tracking', async () => {
		const fixture = await render(event(), {
			signedIn: true,
			status: 'tracking',
			japanese: true,
		})
		const root = fixture.appHost

		await press(root, statusButton('applied'))

		expect(harness.setStatus).toHaveBeenCalledWith('ev-1', 'applied')
		expect(
			root.querySelector(statusButton('applied'))?.getAttribute('aria-pressed'),
		).toBe('true')
		expect(textOf(root, notify)).toBe('🔔 チケット販売の通知を受け取る')
		expect(root.querySelector(notify)?.getAttribute('data-emphasis')).toBe(
			'secondary',
		)
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Clear a status"
	it('clears the status when the selected status is pressed', async () => {
		const fixture = await render(event(), { signedIn: true, status: 'applied' })

		await press(fixture.appHost, statusButton('applied'))

		expect(harness.remove).toHaveBeenCalledWith('ev-1')
		expect(harness.setStatus).not.toHaveBeenCalled()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "After losing"
	it('offers the next sale after losing', async () => {
		const fixture = await render(event(), {
			signedIn: true,
			status: 'lost',
			japanese: true,
		})
		const root = fixture.appHost
		expect(textOf(root, notify)).toBe('🔔 次のチケット販売の通知を受け取る')
		expect(root.querySelector(notify)?.getAttribute('data-emphasis')).toBe(
			'primary',
		)

		await press(root, notify)

		expect(harness.setStatus).toHaveBeenCalledWith('ev-1', 'tracking')
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Ticket secured"
	it('hides the notification button once tickets are paid', async () => {
		const fixture = await render(event(), { signedIn: true, status: 'paid' })
		const root = fixture.appHost
		expect(root.querySelector(notify)).toBeNull()
		expect(
			root.querySelector(statusButton('paid'))?.getAttribute('aria-pressed'),
		).toBe('true')
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Authenticated user sees the status controls"
	// @spec components/infrastructure/fan/web/route/dashboard "Display ticket journey status"
	// @spec components/infrastructure/fan/web/route/dashboard "One row for four statuses"
	// @spec components/infrastructure/fan/web/route/dashboard "Canonical presentation kept"
	// @spec components/infrastructure/fan/web/route/dashboard "Meaning survives without colour"
	it('shows the four other statuses in one row in journey order, 落選 after a separator', async () => {
		const fixture = await render(event(), { signedIn: true, japanese: true })
		const row = fixture.appHost.querySelector('.journey-row') as Element
		const items = [...row.children].map((el) =>
			el.classList.contains('journey-separator')
				? '|'
				: el.classList.contains('journey-arrow')
					? '›'
					: el.textContent?.replace(/\s+/g, ''),
		)
		expect(items).toEqual([
			'📝申込済み',
			'›',
			'💰当選・未入金',
			'›',
			'🎟️入金済み',
			'|',
			'💔落選',
		])
		expect(row.querySelector('[data-journey-status="tracking"]')).toBeNull()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Pressed state"
	it('exposes the pressed state of every status', async () => {
		const fixture = await render(event(), { signedIn: true, status: 'applied' })
		const pressed = [
			...fixture.appHost.querySelectorAll(
				'.sheet-tickets button[aria-pressed]',
			),
		].map((el) => [
			el.getAttribute('data-journey-status'),
			el.getAttribute('aria-pressed'),
		])
		expect(pressed).toEqual([
			['tracking', 'false'],
			['applied', 'true'],
			['unpaid', 'false'],
			['paid', 'false'],
			['lost', 'false'],
		])
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Keyboard"
	it('makes every status a native button, reached with Tab and activated with Enter or Space', async () => {
		const fixture = await render(event(), { signedIn: true, status: 'paid' })
		const buttons = [
			...fixture.appHost.querySelectorAll(
				'.sheet-tickets button[aria-pressed]',
			),
		]
		expect(buttons).toHaveLength(4)
		for (const button of buttons) {
			expect(button.tagName).toBe('BUTTON')
			expect(button.getAttribute('tabindex')).toBeNull()
			expect(button.getAttribute('role')).toBeNull()
		}
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Unauthenticated user sees no status row"
	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Guest presses the button"
	it('shows a guest the notification button that starts sign-up, and no status row', async () => {
		const fixture = await render(event(), { signedIn: false, japanese: true })
		const root = fixture.appHost
		expect(root.querySelector('.journey-row')).toBeNull()
		expect(textOf(root, notify)).toBe('🔔 チケット販売の通知を受け取る')
		expect(textOf(root, '[data-testid="push-line"]')).toBe(
			'アカウントを作ると、販売開始をプッシュ通知で受け取れます',
		)

		await press(root, notify)

		expect(harness.setStatus).not.toHaveBeenCalled()
		expect(harness.signUp).toHaveBeenCalledWith(
			expect.objectContaining({
				source: 'ticket_notify',
				returnTo: '/concerts/ev-1',
				trackEventId: 'ev-1',
			}),
		)
		await fixture.stop(true)
	})
})

describe('EventDetailSheet push line (fixture)', () => {
	const line = '[data-testid="push-line"]'

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Tracking with push on"
	it('says what Tracking pushes when push is on', async () => {
		const fixture = await render(event(), {
			signedIn: true,
			status: 'tracking',
			push: 'on',
			japanese: true,
		})
		expect(textOf(fixture.appHost, line)).toBe(
			'販売開始と抽選の締め切りをプッシュ通知します🔔',
		)
		expect(fixture.appHost.querySelector(`${line} button`)).toBeNull()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Tracking with push off"
	// @spec components/infrastructure/fan/web/global/notification-prompt "Offer in the ticket section"
	// @spec components/infrastructure/fan/web/global/notification-prompt "Fan allows from the event detail sheet"
	it('offers push beside the line when push is off', async () => {
		const fixture = await render(event(), {
			signedIn: true,
			status: 'tracking',
			push: 'offerable',
			japanese: true,
		})
		const root = fixture.appHost
		expect(textOf(root, `${line} span`)).toBe(
			'販売開始と抽選の締め切りをプッシュ通知で受け取ろう🔔',
		)
		expect(textOf(root, `${line} button`)).toBe('オンにする')

		;(root.querySelector(`${line} button`) as HTMLButtonElement).click()

		// Within the press, so the browser prompt follows it.
		expect(harness.accept).toHaveBeenCalledWith({
			source: 'event_detail_sheet',
		})
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Applied"
	it('says the result day is pushed for Applied', async () => {
		const fixture = await render(event(), {
			signedIn: true,
			status: 'applied',
			push: 'on',
			japanese: true,
		})
		expect(textOf(fixture.appHost, line)).toBe(
			'発表日がわかる抽選は、結果発表の日にプッシュ通知します🔔',
		)
		await fixture.stop(true)
	})

	it.each([
		[undefined, '販売開始と抽選の締め切りをプッシュ通知で受け取れます'],
		['unpaid', '期限までに入金を済ませましょう'],
		['paid', undefined],
		['lost', undefined],
	] as const)('shows the line of status %s', async (status, expected) => {
		const fixture = await render(event(), {
			signedIn: true,
			status,
			push: 'offerable',
			japanese: true,
		})
		expect(textOf(fixture.appHost, line)).toBe(expected)
		await fixture.stop(true)
	})

	it('links to Settings where push cannot be turned on here', async () => {
		const fixture = await render(event(), {
			signedIn: true,
			status: 'applied',
			push: 'settings',
			japanese: true,
		})
		expect(textOf(fixture.appHost, `${line} button`)).toBe('設定')
		await fixture.stop(true)
	})
})

describe('EventDetailSheet out-of-range notice (fixture)', () => {
	const notice = '[data-testid="out-of-range"]'

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Nearby fan opens a distant concert"
	it('says the current level pushes only nearby concerts and offers Away', async () => {
		const fixture = await render(event({ lane: 'away', matched: false }), {
			signedIn: true,
			hype: 'nearby',
			japanese: true,
		})
		const root = fixture.appHost
		expect(textOf(root, `${notice} .out-of-range-text`)).toBe(
			'今は東京周辺の新着ライブだけプッシュ通知対象です',
		)
		expect(textOf(root, `${notice} .reach-words`)).toBe('東京周辺')
		expect(textOf(root, `${notice} .out-of-range-action`)).toBe(
			'全ての新着ライブを受け取る',
		)
		// Under the venue, above the ticket section.
		expect(
			root
				.querySelector(notice)
				?.compareDocumentPosition(
					root.querySelector('.sheet-tickets') as Node,
				) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Widening"
	it('sets the lowest matching level as the fan own choice and says what it pushes', async () => {
		const fixture = await render(event({ lane: 'away', matched: false }), {
			signedIn: true,
			hype: 'nearby',
			push: 'on',
			japanese: true,
		})
		const root = fixture.appHost

		await press(root, `${notice} .out-of-range-action`)

		expect(harness.setHype).toHaveBeenCalledWith('a1', 'away')
		expect(textOf(root, `${notice} .out-of-range-text`)).toBe(
			'全ての新着ライブをプッシュ通知します🔔',
		)
		expect(root.querySelector(`${notice} .out-of-range-action`)).toBeNull()
		await fixture.stop(true)
	})

	it('offers push with the widened line when push is off', async () => {
		const fixture = await render(event({ lane: 'nearby', matched: false }), {
			signedIn: true,
			hype: 'home',
			push: 'offerable',
			japanese: true,
		})
		const root = fixture.appHost
		expect(textOf(root, `${notice} .out-of-range-action`)).toBe(
			'東京周辺の新着ライブも受け取る',
		)

		await press(root, `${notice} .out-of-range-action`)

		expect(harness.setHype).toHaveBeenCalledWith('a1', 'nearby')
		expect(textOf(root, `${notice} .out-of-range-text`)).toBe(
			'東京周辺の新着ライブをプッシュ通知で受け取ろう🔔',
		)
		expect(textOf(root, `${notice} .push-action`)).toBe('オンにする')
		await fixture.stop(true)
	})

	it('says Watch pushes nothing and offers the home lane', async () => {
		const fixture = await render(event({ lane: 'home', matched: false }), {
			signedIn: true,
			hype: 'watch',
			japanese: true,
		})
		expect(textOf(fixture.appHost, `${notice} .out-of-range-text`)).toBe(
			'今は新着ライブをプッシュ通知していません',
		)
		expect(textOf(fixture.appHost, `${notice} .out-of-range-action`)).toBe(
			'東京の新着ライブを受け取る',
		)
		await fixture.stop(true)
	})

	it('keeps the notice and says so when the save fails', async () => {
		const fixture = await render(event({ lane: 'away', matched: false }), {
			signedIn: true,
			hype: 'nearby',
			setHype: async () => {
				throw new Error('rpc')
			},
		})

		await press(fixture.appHost, `${notice} .out-of-range-action`)

		expect(
			fixture.appHost.querySelector(`${notice} .out-of-range-action`),
		).not.toBeNull()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Matched concert"
	it('shows no notice for a concert the level matches', async () => {
		const fixture = await render(event({ lane: 'away' }), {
			signedIn: true,
			hype: 'away',
		})
		expect(fixture.appHost.querySelector(notice)).toBeNull()
		await fixture.stop(true)
	})

	it('shows no notice in the All Nearby view, whose lane is the browsed area', async () => {
		const fixture = await render(event({ lane: 'away', matched: false }), {
			signedIn: true,
			hype: 'nearby',
		})
		fixture.component.sheet.isAllNearby = true
		await tasksSettled()

		expect(fixture.appHost.querySelector(notice)).toBeNull()
		await fixture.component.sheet.widenHype()
		expect(harness.setHype).not.toHaveBeenCalled()
		await fixture.stop(true)
	})

	it("lets a host with its own sign-up prompt show it for a guest's 登録する", async () => {
		const fixture = await render(event(), { signedIn: false })
		const prompt = vi.fn()
		fixture.component.sheet.onSignupRequested = prompt

		fixture.component.sheet.pushAction?.callback()

		expect(prompt).toHaveBeenCalledOnce()
		expect(harness.signUp).not.toHaveBeenCalled()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/event-detail-sheet "Artist not followed"
	it('shows no notice for an artist the fan does not follow', async () => {
		const fixture = await render(event({ lane: undefined, matched: false }), {
			signedIn: true,
		})
		expect(fixture.appHost.querySelector(notice)).toBeNull()
		await fixture.stop(true)
	})
})
