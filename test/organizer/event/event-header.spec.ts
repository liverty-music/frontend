import { IRouter, IRouterEvents } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import {
	PublishState,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventRoute } from '../../../organizer/event/event-route'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import { IOrganizerClient } from '../../../organizer/services/organizer-client'
import { ISeriesClient } from '../../../organizer/services/series-client'
import { IBreadcrumbs } from '../../../organizer/shell/breadcrumbs'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { ConsoleUi } from '../../../organizer/ui'
import { IAppConfig } from '../../../shared/config/app-config'
import { authoredSeries } from '../authored-series'
import {
	controlNamed,
	deepAll,
	deepOne,
	deepText,
	installDialogAndPopover,
} from '../console-dom'

/**
 * The event page's header as the member sees it: the real route template and
 * the console's components, with the series and organizer clients faked.
 */

const SPEC = 'components/infrastructure/organizer/web/route/event'

/** 2026-11-03 18:00 in Japan time. */
const START = new Date(Date.UTC(2026, 10, 3, 9, 0))
/** The fan origin of the `dev` environment. */
const FAN_PAGE = 'https://dev.liverty-music.app/events/e-1103'
const BASE = '/organizers/org-1/artists/a-1/series/s-tour'

function tour(
	publishState: PublishState,
	visibility: Visibility = Visibility.PUBLIC,
) {
	return authoredSeries({
		series: {
			id: { value: 's-tour' },
			title: { value: 'XX Tour 2026' },
			visibility,
		},
		events: [
			{
				id: { value: 'e-1103' },
				publishState,
				localDate: { value: { year: 2026, month: 11, day: 3 } },
				startTime: { value: timestampFromDate(START) },
				venue: { name: { value: 'Zepp Haneda' } },
			},
		],
		performers: [{ id: { value: 'a-1' } }],
	})
}

/** The messages the console's snackbar shows. */
function snackMessages(root: ParentNode): string[] {
	return deepAll(root, '.snack-message').map((el) => deepText(el))
}

/** Replaces the clipboard and returns what was written to it. */
function stubClipboard(): string[] {
	const written: string[] = []
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: {
			writeText: async (text: string) => {
				written.push(text)
			},
		},
	})
	return written
}

async function mount(
	concert: ReturnType<typeof tour>,
	publish: ReturnType<typeof vi.fn> = vi.fn(),
	path = `${BASE}/events/e-1103/ticket-sales`,
) {
	window.history.pushState({}, '', path)
	const list = vi.fn().mockResolvedValue([concert])
	const cancel = vi.fn().mockResolvedValue(undefined)
	const fixture = createFixture(
		'<console-snackbar></console-snackbar><event-route></event-route>',
		class {},
		[
			ConsoleI18nConfiguration,
			...ConsoleFormatters,
			...ConsoleUi,
			EventRoute,
			Registration.instance(ISeriesClient, { list, publish, cancel }),
			Registration.instance(IOrganizerClient, {
				get: vi.fn().mockResolvedValue(undefined),
			}),
			Registration.instance(IBreadcrumbs, { set: vi.fn() }),
			Registration.instance(IRouter, { load: vi.fn() }),
			Registration.instance(IRouterEvents, {
				subscribe: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			}),
			Registration.instance(IConsoleContext, {
				scope: { organizer: 'org-1', artist: 'a-1' },
			}),
			Registration.instance(IAppConfig, { environment: 'dev' }),
		],
	)
	await fixture.startPromise
	const host = fixture.appHost.querySelector('event-route') as HTMLElement
	const vm = CustomElement.for<EventRoute>(host).viewModel
	await vm.loading({ artistId: 'a-1', seriesId: 's-tour', eventId: 'e-1103' })
	await tasksSettled()
	const header = () => host.querySelector('header.header') as HTMLElement
	const actions = () => header().querySelector('.actions') as HTMLElement
	return { fixture, host, vm, header, actions, publish, cancel }
}

describe('event page header', () => {
	let restore: () => void
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
		restore = installDialogAndPopover()
	})
	afterEach(() => {
		restore()
		vi.restoreAllMocks()
		window.history.pushState({}, '', '/')
	})

	it(`@spec ${SPEC} "Draft event"`, async () => {
		const { fixture, host, header, actions } = await mount(
			tour(PublishState.DRAFT),
		)

		expect(host.querySelector('h1')?.textContent?.trim()).toBe(
			'11月3日(火) 18:00 JST',
		)
		expect(header().textContent).toContain('XX Tour 2026')
		expect(header().querySelector('.venue')?.textContent).toBe('Zepp Haneda')
		expect(deepText(header().querySelector('status-badge') as Element)).toBe(
			'下書き',
		)
		// 公開する is the page's one filled action.
		const filled = deepAll(actions(), '[data-variant="filled"]')
		expect(filled.map((el) => deepText(el))).toEqual(['公開する'])
		// 中止する and 公演を編集 are in the header's menu, not beside it.
		const menu = actions().querySelector('overflow-menu') as HTMLElement
		expect(
			deepAll(menu, '[role="menuitem"]').map((el) => deepText(el)),
		).toEqual(['中止する', '公演を編集'])
		expect(controlNamed(menu, '公演を編集')?.getAttribute('href')).toBe(
			`${BASE}/edit`,
		)
		expect(
			deepAll(actions(), 'button').filter((b) => deepText(b) === '中止する')
				.length,
		).toBe(1)
		// A draft date has no fan page.
		expect(host.querySelector('copy-field')).toBeNull()
		await fixture.tearDown()
	})

	it('asks before cancelling a draft date, and says it is removed', async () => {
		const { fixture, host, cancel } = await mount(tour(PublishState.DRAFT))
		const menu = host.querySelector('overflow-menu') as HTMLElement

		const item = controlNamed(menu, '中止する')
		item?.click()
		await tasksSettled()

		const dialogs = deepAll<HTMLDialogElement>(host, 'dialog')
		const open = dialogs.filter((d) => d.hasAttribute('open'))
		expect(open).toHaveLength(1)
		expect(deepText(open[0])).toContain(
			'XX Tour 2026 のこの公演日を中止しますか？',
		)
		expect(deepText(open[0])).toContain('下書きの公演日は削除されます')
		controlNamed(open[0], 'やめる')?.click()
		await tasksSettled()
		expect(open[0].hasAttribute('open')).toBe(false)
		expect(cancel).not.toHaveBeenCalled()
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "Publish confirmed"`, async () => {
		const publish = vi.fn().mockResolvedValue(tour(PublishState.PUBLISHED))
		const { fixture, host, header, actions } = await mount(
			tour(PublishState.DRAFT),
			publish,
		)

		controlNamed(actions(), '公開する')?.click()
		await tasksSettled()

		const open = deepAll<HTMLDialogElement>(host, 'dialog').filter((d) =>
			d.hasAttribute('open'),
		)
		expect(open).toHaveLength(1)
		const text = deepText(open[0])
		// It publishes this date alone and points to the concert page for several.
		expect(text).toContain('XX Tour 2026 のこの公演日を公開しますか？')
		expect(text).toContain('この公演日だけを公開し')
		expect(text).toContain('出演者のフォロワーに通知します')
		expect(text).toContain('公演ページから公開してください')
		deepOne(open[0], '[data-role="confirm"]')?.click()
		await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
		await tasksSettled()

		expect(publish).toHaveBeenCalledWith('s-tour', ['e-1103'])
		expect(deepText(header().querySelector('status-badge') as Element)).toBe(
			'公開中',
		)
		expect(snackMessages(fixture.appHost)).toEqual(['公開しました'])
		expect(controlNamed(actions(), '公開する')).toBeNull()
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "Public date"`, async () => {
		const written = stubClipboard()
		const { fixture, host } = await mount(tour(PublishState.PUBLISHED))

		const fanPage = host.querySelector('copy-field') as HTMLElement
		expect(deepText(fanPage)).toContain(FAN_PAGE)
		controlNamed(fanPage, 'ファンページをコピー')?.click()
		await vi.waitFor(() => expect(written).toEqual([FAN_PAGE]))
		await tasksSettled()

		expect(snackMessages(fixture.appHost)).toEqual(['コピーしました'])
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "Unlisted concert"`, async () => {
		const { fixture, host, header } = await mount(
			tour(PublishState.PUBLISHED, Visibility.UNLISTED),
		)

		expect(deepText(header().querySelector('status-badge') as Element)).toBe(
			'公開中',
		)
		expect(host.querySelector('copy-field')).toBeNull()
		expect(deepText(host)).not.toContain('/events/e-1103')
		await fixture.tearDown()
	})
})
