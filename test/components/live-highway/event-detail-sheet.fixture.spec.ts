import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { IHistory } from '../../../src/adapter/browser/history'
import { EventDetailSheet } from '../../../src/components/live-highway/event-detail-sheet'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
import { SvgIcon } from '../../../src/components/svg-icon/svg-icon'
import { IAnalyticsService } from '../../../src/lib/analytics/analytics-service'
import { IAuthService } from '../../../src/services/auth-service'
import { IFollowStore } from '../../../src/services/follow-store'
import { ITicketJourneyStore } from '../../../src/services/ticket-journey-store'
import { DateValueConverter } from '../../../src/value-converters/date'
import { createMockAuth } from '../../helpers/mock-auth'
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

async function render(ev: LiveEvent) {
	const fixture = await createFixture(
		'<event-detail-sheet event.bind="ev" component.ref="sheet"></event-detail-sheet>',
		class Host {
			public ev = ev
			public sheet!: EventDetailSheet
		},
		[
			I18nConfiguration.customize((o) => {
				o.initOptions = { lng: 'en', resources: { en: { translation: {} } } }
			}),
			EventDetailSheet,
			BottomSheetStub,
			SvgIcon,
			DateValueConverter,
			Registration.instance(
				IAuthService,
				createMockAuth({ isAuthenticated: false }),
			),
			Registration.instance(IHistory, createMockHistory()),
			Registration.instance(IFollowStore, {
				followedIds: new Set(),
				follow: vi.fn(),
			}),
			Registration.instance(ITicketJourneyStore, {
				journeyMap: new Map(),
				statusFor: () => undefined,
			}),
			Registration.instance(IAnalyticsService, { capture: vi.fn() }),
		],
	).started
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
			'a.detail-link',
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
			'a.sheet-btn-primary',
		) as HTMLAnchorElement
		expect(link.href).toBe('https://example.com/live')
		expect(link.target).toBe('_blank')
		expect(link.textContent).toContain('eventDetail.viewOfficialInfo')
		await fixture.stop(true)
	})
})
