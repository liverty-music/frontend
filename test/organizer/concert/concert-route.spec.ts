import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import {
	PublishState,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConcertRoute } from '../../../organizer/concert/concert-route'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import ja from '../../../organizer/locales/ja/translation.json'
import { ISeatTypeClient } from '../../../organizer/services/seat-type-client'
import { ISeriesClient } from '../../../organizer/services/series-client'
import { ITicketSaleClient } from '../../../organizer/services/ticket-sale-client'
import { ITicketStockClient } from '../../../organizer/services/ticket-stock-client'
import { IBreadcrumbs } from '../../../organizer/shell/breadcrumbs'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { ConsoleSnackbar } from '../../../organizer/ui/console-snackbar/console-snackbar'
import { ISnackbar } from '../../../organizer/ui/console-snackbar/snackbar'
import { authoredSeries } from '../authored-series'

/** 2026-12-11 18:00 in Japan time. */
const DRAFT_START = new Date(Date.UTC(2026, 11, 11, 9, 0))

const draftConcert = authoredSeries({
	series: {
		id: { value: 's-1' },
		title: { value: 'XX Tour 2026' },
		visibility: Visibility.PUBLIC,
	},
	events: [
		{
			id: { value: 'e-1' },
			publishState: PublishState.DRAFT,
			localDate: { value: { year: 2026, month: 12, day: 11 } },
			startTime: { value: timestampFromDate(DRAFT_START) },
			venue: { name: { value: 'Zepp Haneda' } },
		},
	],
	performers: [{ id: { value: 'a-1' } }],
})

/**
 * The concert page built from the fixture's container with its clients
 * stubbed; the console's real snackbar host is rendered so a message is read
 * as the member sees it.
 */
async function mount(publish: ReturnType<typeof vi.fn>) {
	const list = vi.fn().mockResolvedValue([draftConcert])
	const fixture = createFixture(
		'<console-snackbar></console-snackbar>',
		class {},
		[
			ConsoleI18nConfiguration,
			ConsoleSnackbar,
			Registration.instance(ISeriesClient, { list, publish }),
			Registration.instance(ITicketSaleClient, {
				listByEvent: vi.fn().mockResolvedValue([]),
			}),
			Registration.instance(ISeatTypeClient, {
				listBySeries: vi.fn().mockResolvedValue([]),
			}),
			Registration.instance(ITicketStockClient, {
				listByEvent: vi.fn().mockResolvedValue([]),
			}),
			Registration.instance(IBreadcrumbs, { set: vi.fn() }),
			Registration.instance(IRouter, { load: vi.fn() }),
			Registration.instance(IConsoleContext, {
				scope: { organizer: 'org-1', artist: 'a-1' },
				artistId: 'a-1',
			}),
		],
	)
	await fixture.startPromise
	await tasksSettled()
	const vm: ConcertRoute = fixture.container.invoke(ConcertRoute)
	vm.loading({ artistId: 'a-1', seriesId: 's-1' })
	await vm.load()
	vm.publishDialog = { ask: vi.fn().mockResolvedValue(true) } as never
	const snackbar = fixture.container.get(ISnackbar)
	const host = fixture.appHost.querySelector('console-snackbar')
	if (!host?.shadowRoot) throw new Error('console-snackbar did not render')
	const root = host.shadowRoot
	const done = async () => {
		await tasksSettled()
		vm.detaching()
		await fixture.tearDown()
	}
	return { vm, list, snackbar, root, done }
}

describe('concert page publish', () => {
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
		// jsdom has no Popover API; the snack-bar opens each message as a popover.
		HTMLElement.prototype.showPopover ??= () => {}
		HTMLElement.prototype.hidePopover ??= () => {}
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('@spec components/infrastructure/organizer/web/route/concert "Date already used by another concert"', async () => {
		const publish = vi
			.fn()
			.mockRejectedValue(new ConnectError('slot held', Code.FailedPrecondition))
		const { vm, list, snackbar, root, done } = await mount(publish)
		const showError = vi.spyOn(snackbar, 'showError')

		await vm.publish()
		await tasksSettled()

		expect(publish).toHaveBeenCalledWith('s-1', ['e-1'])
		expect(showError).toHaveBeenCalledTimes(1)
		expect(showError).toHaveBeenCalledWith('event.publishSlotUsed')
		expect(root.querySelector('.snack-message')?.textContent?.trim()).toBe(
			ja.event.publishSlotUsed,
		)
		expect(ja.event.publishSlotUsed).toBe(
			'同じ会場・日時の公演日がほかの公演にあるか、中止した公演日があるため公開できませんでした。公演の編集で日付か開始時刻を変えてください',
		)
		expect(root.querySelector('.snack-action-btn')).toBeNull()
		// The page reads the concert again and still shows the date as a draft.
		expect(list).toHaveBeenCalledTimes(2)
		expect(vm.rows[0]?.cells.state).toMatchObject({
			labelKey: 'publishState.draft',
		})
		expect(vm.publishing).toBe(false)
		await done()
	})

	it('keeps the generic message for a publish that failed to run', async () => {
		const publish = vi
			.fn()
			.mockRejectedValue(new ConnectError('down', Code.Unavailable))
		const { vm, list, snackbar, done } = await mount(publish)
		const showError = vi.spyOn(snackbar, 'showError')

		await vm.publish()

		expect(showError).toHaveBeenCalledWith('event.publishFailed')
		expect(list).toHaveBeenCalledTimes(1)
		await done()
	})
})
