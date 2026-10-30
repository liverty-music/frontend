import { IRouter, IRouterEvents } from '@aurelia/router'
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
import { EventRoute } from '../../../organizer/event/event-route'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import ja from '../../../organizer/locales/ja/translation.json'
import { IOrganizerClient } from '../../../organizer/services/organizer-client'
import { ISeriesClient } from '../../../organizer/services/series-client'
import { IBreadcrumbs } from '../../../organizer/shell/breadcrumbs'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { ConsoleSnackbar } from '../../../organizer/ui/console-snackbar/console-snackbar'
import { ISnackbar } from '../../../organizer/ui/console-snackbar/snackbar'
import { IAppConfig } from '../../../shared/config/app-config'
import { authoredSeries } from '../authored-series'

const SPEC = 'components/infrastructure/organizer/web/global/error-messages'

/** The message the server sent with the failure. */
const SERVER_MESSAGE = 'publish series: deadline exceeded (internal)'

type Route = InstanceType<typeof EventRoute>

/** 2026-11-20 19:00 in Japan time. */
const EVENT_START = new Date(Date.UTC(2026, 10, 20, 10, 0))
const EVENT_PATH = '/organizers/org-1/artists/a-1/series/s-1/events/e-1'

function concertOf(
	publishState: PublishState,
	init: { visibility?: Visibility; start?: boolean } = {},
) {
	return authoredSeries({
		series: {
			id: { value: 's-1' },
			title: { value: 'XX Tour' },
			visibility: init.visibility ?? Visibility.PUBLIC,
		},
		events: [
			{
				id: { value: 'e-1' },
				publishState,
				localDate: { value: { year: 2026, month: 11, day: 20 } },
				...(init.start === false
					? {}
					: { startTime: { value: timestampFromDate(EVENT_START) } }),
				venue: { name: { value: 'Zepp Shinjuku' } },
			},
		],
		performers: [{ id: { value: 'a-1' } }],
	})
}

interface Doubles {
	list: ReturnType<typeof vi.fn>
	publish: ReturnType<typeof vi.fn>
	cancel: ReturnType<typeof vi.fn>
	load: ReturnType<typeof vi.fn>
	setCrumbs: ReturnType<typeof vi.fn>
	subscribe: ReturnType<typeof vi.fn>
	dispose: ReturnType<typeof vi.fn>
}

/**
 * The event page's route is a router viewport with child routes, so it is
 * built from the fixture's container rather than rendered, with the real
 * event page data it reads; the console's real snackbar host is rendered so
 * a message is read as the member sees it.
 */
async function mount(
	over: Partial<Doubles> = {},
	environment: 'dev' | 'prod' = 'prod',
) {
	const dispose = over.dispose ?? vi.fn()
	const d: Doubles = {
		list: vi.fn().mockResolvedValue([concertOf(PublishState.DRAFT)]),
		publish: vi.fn(),
		cancel: vi.fn().mockResolvedValue(undefined),
		load: vi.fn().mockResolvedValue(undefined),
		setCrumbs: vi.fn(),
		subscribe: vi.fn().mockReturnValue({ dispose }),
		dispose,
		...over,
	}
	const fixture = createFixture(
		'<console-snackbar></console-snackbar>',
		class {},
		[
			ConsoleI18nConfiguration,
			ConsoleSnackbar,
			Registration.instance(ISeriesClient, {
				list: d.list,
				publish: d.publish,
				cancel: d.cancel,
			}),
			Registration.instance(IOrganizerClient, {
				get: vi.fn().mockResolvedValue(undefined),
			}),
			Registration.instance(IBreadcrumbs, { set: d.setCrumbs }),
			Registration.instance(IRouter, { load: d.load }),
			Registration.instance(IRouterEvents, { subscribe: d.subscribe }),
			Registration.instance(IConsoleContext, {
				scope: { organizer: 'org-1', artist: 'a-1' },
			}),
			Registration.instance(IAppConfig, { environment }),
		],
	)
	await fixture.startPromise
	await tasksSettled()
	const vm: Route = fixture.container.invoke(EventRoute)
	await vm.loading({ artistId: 'a-1', seriesId: 's-1', eventId: 'e-1' })
	vm.binding()
	vm.publishDialog = { ask: vi.fn().mockResolvedValue(true) } as never
	vm.cancelDialog = { ask: vi.fn().mockResolvedValue(true) } as never
	const snackbar = fixture.container.get(ISnackbar)
	const host = fixture.appHost.querySelector('console-snackbar')
	if (!host?.shadowRoot) throw new Error('console-snackbar did not render')
	const root = host.shadowRoot
	/** The newest message: the stub popover never closes the older ones. */
	const lastMessage = () =>
		[...root.querySelectorAll('.snack-message')].at(-1)?.textContent?.trim()
	const done = async () => {
		await tasksSettled()
		await Promise.resolve()
		vm.unbinding()
		await fixture.tearDown()
	}
	return { fixture, vm, snackbar, root, d, lastMessage, done }
}

describe('event page publish', () => {
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

	it(`@spec ${SPEC} "Publish fails without copy of its own"`, async () => {
		const err = new ConnectError(SERVER_MESSAGE, Code.Internal)
		const publish = vi
			.fn()
			.mockRejectedValueOnce(err)
			.mockResolvedValueOnce(undefined)
		const { vm, snackbar, root, lastMessage, done } = await mount({ publish })
		// biome-ignore lint/complexity/useLiteralKeys: logger is private; bracket access is the type-checked way to reach it
		const warn = vi.spyOn(vm['logger'], 'warn')
		const showError = vi.spyOn(snackbar, 'showError')

		await vm.publish()
		await tasksSettled()

		// An Internal error takes the catch-all branch: the page's own copy with Retry.
		expect(showError).toHaveBeenCalledTimes(1)
		expect(showError).toHaveBeenCalledWith('event.publishFailed', {
			retry: expect.any(Function),
		})
		expect(JSON.stringify(showError.mock.calls)).not.toContain(SERVER_MESSAGE)
		expect(warn).toHaveBeenCalledWith('Publish failed', err)

		expect(ja.event.publishFailed).toBe('公開できませんでした')
		expect(ja.common.retry).toBe('再試行')
		const message = root.querySelector('.snack-message')?.textContent?.trim()
		expect(message).toBe('公開できませんでした')
		const action = root.querySelector<HTMLButtonElement>('.snack-action-btn')
		expect(action?.textContent?.trim()).toBe('再試行')
		expect(root.textContent).not.toContain(SERVER_MESSAGE)
		expect(document.body.textContent).not.toContain('deadline exceeded')

		// 再試行 publishes the same event again without asking a second time.
		action?.click()
		await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2))
		expect(publish).toHaveBeenLastCalledWith('s-1', ['e-1'])
		expect(vm.publishDialog.ask).toHaveBeenCalledTimes(1)
		await vi.waitFor(() => expect(lastMessage()).toBe(ja.event.published))
		await done()
	})

	it('reads its concert and event, and shows them in the header', async () => {
		const { vm, d, done } = await mount()

		expect(vm.page.state).toBe('ready')
		expect(vm.title).toBe('XX Tour')
		expect(vm.start).toEqual(EVENT_START)
		expect(vm.day).toEqual(new Date('2026-11-19T15:00:00Z'))
		expect(vm.venue).toBe('Zepp Shinjuku')
		expect(vm.draft).toBe(true)
		expect(vm.cancelled).toBe(false)
		expect(vm.unlisted).toBe(false)
		expect(vm.badge.labelKey).toBe('publishState.draft')
		expect(vm.concertHref).toBe('/organizers/org-1/artists/a-1/series/s-1')
		expect(vm.editHref).toBe('/organizers/org-1/artists/a-1/series/s-1/edit')
		expect(vm.tabs.map((t) => [t.id, t.href])).toEqual([
			['sales', `${EVENT_PATH}/ticket-sales`],
			['reception', `${EVENT_PATH}/scanners`],
		])
		// The breadcrumb: concerts > the concert > the day.
		expect(d.setCrumbs).toHaveBeenLastCalledWith([
			{
				labelKey: 'shell.nav.concerts',
				href: '/organizers/org-1/artists/a-1/series',
			},
			{ label: 'XX Tour', href: '/organizers/org-1/artists/a-1/series/s-1' },
			{ day: vm.day },
		])
		await done()
	})

	it('says the event was not found when the concert has no such event', async () => {
		const { vm, done } = await mount({ list: vi.fn().mockResolvedValue([]) })

		expect(vm.page.state).toBe('notFound')
		expect(vm.title).toBe('')
		expect(vm.start).toBeUndefined()
		expect(vm.day).toBeUndefined()
		expect(vm.venue).toBe('')
		expect(vm.draft).toBe(false)
		expect(vm.fanPageUrl).toBe('')
		await done()
	})

	it('shows the error state when the concerts cannot be read', async () => {
		const { vm, done } = await mount({
			list: vi
				.fn()
				.mockRejectedValue(new ConnectError('down', Code.Unavailable)),
		})
		expect(vm.page.state).toBe('error')
		await done()
	})

	it('shows the fan page address only for a published date of a PUBLIC concert', async () => {
		const published = await mount({
			list: vi.fn().mockResolvedValue([concertOf(PublishState.PUBLISHED)]),
		})
		expect(published.vm.fanPageUrl).toBe('https://liverty-music.app/events/e-1')
		expect(published.vm.badge.labelKey).toBe('publishState.published')
		await published.done()

		const unlisted = await mount({
			list: vi.fn().mockResolvedValue([
				concertOf(PublishState.PUBLISHED, {
					visibility: Visibility.UNLISTED,
				}),
			]),
		})
		expect(unlisted.vm.unlisted).toBe(true)
		expect(unlisted.vm.fanPageUrl).toBe('')
		await unlisted.done()

		const draft = await mount()
		expect(draft.vm.fanPageUrl).toBe('')
		await draft.done()
	})

	it('follows the address: the selected tab and whether a sale editor is open', async () => {
		const { vm, d, done } = await mount()
		const followAddress = d.subscribe.mock.calls[0][1] as () => void

		window.history.pushState({}, '', `${EVENT_PATH}/scanners`)
		followAddress()
		expect(vm.activeTab).toBe('reception')
		expect(vm.editing).toBe(false)

		const crumbs = d.setCrumbs.mock.calls.length
		window.history.pushState({}, '', `${EVENT_PATH}/ticket-sales/fc-1/edit`)
		followAddress()
		expect(vm.editing).toBe(true)
		expect(vm.activeTab).toBe('sales')
		// An open editor owns the breadcrumb.
		expect(d.setCrumbs).toHaveBeenCalledTimes(crumbs)

		window.history.pushState({}, '', `${EVENT_PATH}/ticket-sales/new`)
		followAddress()
		expect(vm.editing).toBe(true)

		window.history.pushState({}, '', '/')
		await done()
		expect(d.dispose).toHaveBeenCalledTimes(1)
		expect(vm.page.publishHandler).toBeNull()
	})

	it('publishes a draft from the header, replacing the concert with the answer', async () => {
		const answer = concertOf(PublishState.PUBLISHED)
		const publish = vi.fn().mockResolvedValue(answer)
		const { vm, lastMessage, done } = await mount({ publish })

		await vm.page.requestPublish()

		expect(publish).toHaveBeenCalledWith('s-1', ['e-1'])
		expect(vm.page.concert).toBe(answer)
		expect(vm.draft).toBe(false)
		expect(vm.publishing).toBe(false)
		await vi.waitFor(() => expect(lastMessage()).toBe(ja.event.published))
		await done()
	})

	it('re-reads the event after a publish that returns no concert', async () => {
		const list = vi
			.fn()
			.mockResolvedValueOnce([concertOf(PublishState.DRAFT)])
			.mockResolvedValueOnce([concertOf(PublishState.PUBLISHED)])
		const { vm, done } = await mount({
			list,
			publish: vi.fn().mockResolvedValue(undefined),
		})

		await vm.publish()

		expect(list).toHaveBeenCalledTimes(2)
		expect(vm.badge.labelKey).toBe('publishState.published')
		await done()
	})

	it('publishes nothing when the member says no, or the date is not a draft', async () => {
		const publish = vi.fn()
		const asked = await mount({ publish })
		vi.mocked(asked.vm.publishDialog.ask).mockResolvedValue(false)
		await asked.vm.publish()
		expect(publish).not.toHaveBeenCalled()
		await asked.done()

		const published = await mount({
			publish,
			list: vi.fn().mockResolvedValue([concertOf(PublishState.PUBLISHED)]),
		})
		await published.vm.publish()
		expect(published.vm.publishDialog.ask).not.toHaveBeenCalled()
		expect(publish).not.toHaveBeenCalled()
		await published.done()
	})

	it('offers no second Retry when the retried publish fails too', async () => {
		const err = new ConnectError('deadline exceeded', Code.Internal)
		const publish = vi.fn().mockRejectedValue(err)
		const { vm, snackbar, done } = await mount({ publish })
		const showError = vi.spyOn(snackbar, 'showError')

		await vm.publish()
		const retry = showError.mock.calls[0][1]?.retry
		retry?.()
		await vi.waitFor(() => expect(showError).toHaveBeenCalledTimes(2))

		expect(showError).toHaveBeenLastCalledWith('event.publishFailed')
		await done()
	})

	it('removes a cancelled draft and returns to its concert', async () => {
		const { vm, d, lastMessage, done } = await mount()

		expect(vm.menu.map((m) => [m.id, m.disabled])).toEqual([
			['cancel', false],
			['edit', undefined],
		])
		vm.onMenu('cancel')
		await vi.waitFor(() => expect(d.load).toHaveBeenCalled())

		expect(d.cancel).toHaveBeenCalledWith('s-1', ['e-1'])
		expect(d.load).toHaveBeenCalledWith(
			'/organizers/org-1/artists/a-1/series/s-1',
		)
		await vi.waitFor(() => expect(lastMessage()).toBe(ja.event.draftRemoved))
		expect(vm.cancelling).toBe(false)
		await done()
	})

	it('cancels a published date and re-reads it', async () => {
		const list = vi
			.fn()
			.mockResolvedValueOnce([concertOf(PublishState.PUBLISHED)])
			.mockResolvedValueOnce([concertOf(PublishState.CANCELLED)])
		const { vm, d, lastMessage, done } = await mount({ list })

		await vm.cancel()

		expect(d.load).not.toHaveBeenCalled()
		expect(vm.cancelled).toBe(true)
		expect(vm.menu[0].disabled).toBe(true)
		await vi.waitFor(() => expect(lastMessage()).toBe(ja.event.cancelled))

		// A cancelled date cannot be cancelled again.
		await vm.cancel()
		expect(d.cancel).toHaveBeenCalledTimes(1)
		await done()
	})

	it('says the cancel failed, and cancels nothing when the member says no', async () => {
		const { vm, d, lastMessage, done } = await mount({
			cancel: vi
				.fn()
				.mockRejectedValue(new ConnectError('down', Code.Unavailable)),
		})
		vm.onMenu('edit')
		expect(d.cancel).not.toHaveBeenCalled()

		vi.mocked(vm.cancelDialog.ask).mockResolvedValueOnce(false)
		await vm.cancel()
		expect(d.cancel).not.toHaveBeenCalled()

		await vm.cancel()
		expect(vm.cancelling).toBe(false)
		await vi.waitFor(() => expect(lastMessage()).toBe(ja.event.cancelFailed))
		await done()
	})
})
