import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { IHistory } from '../../../src/adapter/browser/history'
import { EventDetailSheet } from '../../../src/components/live-highway/event-detail-sheet'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
import { SvgIcon } from '../../../src/components/svg-icon/svg-icon'
import type { Artist } from '../../../src/entities/artist'
import { IAnalyticsService } from '../../../src/lib/analytics/analytics-service'
import { IAuthService } from '../../../src/services/auth-service'
import { IErrorBoundaryService } from '../../../src/services/error-boundary-service'
import { IFollowStore } from '../../../src/services/follow-store'
import { ITicketJourneyStore } from '../../../src/services/ticket-journey-store'
import { DateValueConverter } from '../../../src/value-converters/date'
import { createMockAuth } from '../../helpers/mock-auth'
import { createMockErrorBoundary } from '../../helpers/mock-error-boundary'
import { createMockHistory } from '../../helpers/mock-history'

/**
 * The detail sheet's follow CTA, rendered from the real template. The bottom
 * sheet is a pass-through stub (jsdom has no Popover API); its own behaviour is
 * covered by the bottom-sheet specs.
 */
const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<au-slot></au-slot>',
		bindables: ['open', 'dismissable', 'ariaLabel'],
	},
	class {},
)

const ARTIST: Artist = { id: 'a1', name: 'The Band', mbid: '' }

function event(overrides: Partial<LiveEvent> = {}): LiveEvent {
	return {
		id: 'ev-1',
		artistName: 'The Band',
		artistId: 'a1',
		artist: ARTIST,
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

interface Options {
	readonly authenticated?: boolean
	readonly followed?: readonly string[]
}

/**
 * Renders the sheet and opens it on `ev` as the dashboard does, in the All
 * Nearby or the My Timetable context. The follow store is the fan's follow
 * set; `follow` adds to it, as FollowService.Follow does through the store.
 */
async function render(ev: LiveEvent, isAllNearby: boolean, o: Options = {}) {
	const followedIds = new Set<string>(o.followed ?? [])
	const followStore = {
		followedIds,
		follow: vi.fn(async (artist: Artist) => {
			followedIds.add(artist.id)
		}),
	}
	const onSignupRequested = vi.fn()
	const fixture = await createFixture(
		'<event-detail-sheet component.ref="sheet" on-signup-requested.bind="onSignupRequested"></event-detail-sheet>',
		class Host {
			public sheet!: EventDetailSheet
			public onSignupRequested = onSignupRequested
		},
		[
			// Key actions add a step for the error report.
			Registration.instance(IErrorBoundaryService, createMockErrorBoundary()),
			I18nConfiguration.customize((opts) => {
				opts.initOptions = {
					lng: 'en',
					resources: { en: { translation: {} } },
				}
			}),
			EventDetailSheet,
			BottomSheetStub,
			SvgIcon,
			DateValueConverter,
			Registration.instance(
				IAuthService,
				createMockAuth({ isAuthenticated: o.authenticated ?? true }),
			),
			Registration.instance(IHistory, createMockHistory()),
			Registration.instance(IFollowStore, followStore),
			Registration.instance(ITicketJourneyStore, {
				journeyMap: new Map(),
				statusFor: () => undefined,
			}),
			Registration.instance(IAnalyticsService, { capture: vi.fn() }),
		],
	).started
	// The All Nearby view on Discovery opens the sheet with the follow action;
	// the dashboard timetable opens it without.
	fixture.component.sheet.open(
		ev,
		isAllNearby ? 'all_nearby' : 'dashboard',
		isAllNearby,
	)
	await tasksSettled()
	const button = () =>
		fixture.appHost.querySelector<HTMLButtonElement>('.follow-action')
	const following = () =>
		fixture.appHost.querySelector('[data-testid="all-nearby-following"]')
	return { fixture, followStore, onSignupRequested, button, following }
}

describe('EventDetailSheet follow CTA (fixture)', () => {
	// @spec components/infrastructure/fan/web/global/bottom-sheet "Follow button visible for unfollowed artist in All Nearby context"
	it('shows the follow button for an unfollowed artist in All Nearby', async () => {
		const { fixture, button } = await render(event(), true)

		expect(button()?.textContent).toBe('allNearby.follow.action')
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/bottom-sheet "Follow button hidden in My Timetable context"
	it('shows no follow CTA in My Timetable, even for an unfollowed artist', async () => {
		const { fixture, button, following } = await render(event(), false)

		expect(button()).toBeNull()
		expect(following()).toBeNull()
		expect(
			fixture.appHost.querySelector('[data-testid="all-nearby-follow"]'),
		).toBeNull()
		// The rest of the sheet renders as before.
		expect(fixture.appHost.textContent).toContain('Zepp Haneda')
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/bottom-sheet "Follow action from detail sheet"
	it('follows the artist and turns the button into a Following indicator', async () => {
		const { fixture, followStore, button, following } = await render(
			event(),
			true,
		)

		button()?.click()
		await tasksSettled()

		expect(followStore.follow).toHaveBeenCalledOnce()
		expect(followStore.follow).toHaveBeenCalledWith(ARTIST)
		expect(button()).toBeNull()
		expect(following()?.textContent).toBe('allNearby.follow.following')
		// No DNA Orb in the sheet: the follow does not play the absorption.
		expect(fixture.appHost.querySelector('dna-orb')).toBeNull()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/bottom-sheet "Follow button absent when artist data is unresolved"
	it('shows no follow button, and throws nothing, when the artist is unresolved', async () => {
		const { fixture, followStore, button } = await render(
			event({ artist: undefined }),
			true,
		)

		expect(button()).toBeNull()
		// A stale invocation of the write path is guarded, not thrown.
		await expect(fixture.component.sheet.follow()).resolves.toBeUndefined()
		expect(followStore.follow).not.toHaveBeenCalled()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/bottom-sheet "No follow button for already-followed artist"
	it('shows no follow button for an artist the fan already follows', async () => {
		const { fixture, button } = await render(event(), true, {
			followed: ['a1'],
		})

		expect(button()).toBeNull()
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/bottom-sheet "Follow prompt for unauthenticated user"
	it('asks a guest to sign up instead of following', async () => {
		const { fixture, followStore, onSignupRequested, button } = await render(
			event(),
			true,
			{ authenticated: false },
		)

		button()?.click()
		await tasksSettled()

		expect(onSignupRequested).toHaveBeenCalledOnce()
		expect(followStore.follow).not.toHaveBeenCalled()
		await fixture.stop(true)
	})
})
