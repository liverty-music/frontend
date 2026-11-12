import { IRouter, IRouterEvents } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import {
	PublishState,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventRoute } from '../../../organizer/event/event-route'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import { IOrganizerClient } from '../../../organizer/services/organizer-client'
import { ISeriesClient } from '../../../organizer/services/series-client'
import { IBreadcrumbs } from '../../../organizer/shell/breadcrumbs'
import { ConsoleBreadcrumb } from '../../../organizer/shell/console-breadcrumb/console-breadcrumb'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { CrumbText } from '../../../organizer/shell/crumb-text/crumb-text'
import { ConsoleIcon } from '../../../organizer/ui/console-icon/console-icon'
import { IAppConfig } from '../../../shared/config/app-config'
import { authoredSeries } from '../authored-series'

const SPEC = 'components/infrastructure/organizer/web/global/organizer-shell'

const XX_TOUR = authoredSeries({
	series: {
		id: { value: 's-tour' },
		title: { value: 'XX Tour 2026' },
		visibility: Visibility.PUBLIC,
	},
	events: [
		{
			id: { value: 'e-1103' },
			publishState: PublishState.PUBLISHED,
			localDate: { value: { year: 2026, month: 11, day: 3 } },
			startTime: {
				value: timestampFromDate(new Date('2026-11-03T18:00:00+09:00')),
			},
			venue: { name: { value: 'Zepp Haneda' } },
		},
	],
	performers: [{ id: { value: 'a-1' } }],
})

describe('console breadcrumb', () => {
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it(`@spec ${SPEC} "Breadcrumb on an event"`, async () => {
		const fixture = createFixture(
			'<console-breadcrumb></console-breadcrumb>',
			class {},
			[
				ConsoleI18nConfiguration,
				...ConsoleFormatters,
				ConsoleIcon,
				ConsoleBreadcrumb,
				CrumbText,
				Registration.instance(IRouterEvents, {
					subscribe: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				}),
				Registration.instance(IRouter, { load: vi.fn() }),
				Registration.instance(ISeriesClient, {
					list: vi.fn().mockResolvedValue([XX_TOUR]),
				}),
				Registration.instance(IOrganizerClient, {
					get: vi.fn().mockResolvedValue(undefined),
				}),
				Registration.instance(IConsoleContext, {
					scope: { organizer: 'org-1', artist: 'a-1' },
				}),
				Registration.instance(IAppConfig, { environment: 'prod' }),
			],
		)
		await fixture.startPromise

		// A member opens the event of 3 November: its route sets the trail.
		const route: EventRoute = fixture.container.invoke(EventRoute)
		await route.loading({
			artistId: 'a-1',
			seriesId: 's-tour',
			eventId: 'e-1103',
		})
		route.binding()
		await tasksSettled()
		expect(fixture.container.get(IBreadcrumbs).trail).toHaveLength(3)

		const nav = fixture.appHost.querySelector(
			'nav[aria-label="パンくずリスト"]',
		)
		expect(nav).not.toBeNull()
		const items = [...(nav?.querySelectorAll('li') ?? [])]
		expect(
			items.map((li) => li.textContent?.replace(/\s+/g, ' ').trim()),
		).toEqual(['公演', 'XX Tour 2026', '11月3日(火)'])
		// 公演 and XX Tour 2026 are links; the page itself is not.
		const link = (li: Element) => li.querySelector('a')
		expect(link(items[0])?.getAttribute('href')).toBe(
			'/organizers/org-1/artists/a-1/series',
		)
		expect(link(items[1])?.getAttribute('href')).toBe(
			'/organizers/org-1/artists/a-1/series/s-tour',
		)
		expect(link(items[2])).toBeNull()
		expect(items[2].querySelector('[aria-current="page"]')).not.toBeNull()
		route.unbinding()
		await fixture.tearDown()
	})
})
