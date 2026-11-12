import { IRouter, IRouterEvents } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { EventSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import {
	type Scanner,
	ScannerSchema,
	ScannerStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/scanner_pb.js'
import { SeatTypeSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/seat_type_pb.js'
import {
	PublishState,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConcertRoute } from '../../../organizer/concert/concert-route'
import { IEventPage } from '../../../organizer/event/event-page'
import { EventRoute } from '../../../organizer/event/event-route'
import { ReceptionTab } from '../../../organizer/event/reception-tab/reception-tab'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import { IOrganizerClient } from '../../../organizer/services/organizer-client'
import { IScannerClient } from '../../../organizer/services/scanner-client'
import { ISeatTypeClient } from '../../../organizer/services/seat-type-client'
import { ISeriesClient } from '../../../organizer/services/series-client'
import { ITicketSaleClient } from '../../../organizer/services/ticket-sale-client'
import { ITicketStockClient } from '../../../organizer/services/ticket-stock-client'
import { IBreadcrumbs } from '../../../organizer/shell/breadcrumbs'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { ConfirmDialog } from '../../../organizer/ui/confirm-dialog/confirm-dialog'
import { ConsoleButton } from '../../../organizer/ui/console-button/console-button'
import { ConsoleField } from '../../../organizer/ui/console-field/console-field'
import { ConsoleIcon } from '../../../organizer/ui/console-icon/console-icon'
import { ConsoleSnackbar } from '../../../organizer/ui/console-snackbar/console-snackbar'
import { ListItem } from '../../../organizer/ui/list-item/list-item'
import { StatusBadge } from '../../../organizer/ui/status-badge/status-badge'
import { IAppConfig } from '../../../shared/config/app-config'
import { authoredSeries } from '../authored-series'

const STORY = 'stories/run-an-event-from-the-organizer-console'

/** The draft date of XX 単独公演: 20 December 18:00 in Japan time. */
const SOLO = authoredSeries({
	series: {
		id: { value: 's-solo' },
		title: { value: 'XX 単独公演' },
		visibility: Visibility.PUBLIC,
	},
	events: [
		{
			id: { value: 'e-1220' },
			publishState: PublishState.DRAFT,
			localDate: { value: { year: 2026, month: 12, day: 20 } },
			startTime: {
				value: timestampFromDate(new Date('2026-12-20T18:00:00+09:00')),
			},
			venue: { name: { value: 'Zepp Haneda' } },
		},
	],
	performers: [{ id: { value: 'a-1' } }],
})

const CONTEXT = {
	scope: { organizer: 'org-1', artist: 'a-1' },
	artistId: 'a-1',
}

/** The text of a node as a member reads it: slots show what was assigned to them. */
function textOf(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
	const el = node as Element
	if (el instanceof HTMLSlotElement) {
		return el
			.assignedNodes({ flatten: true })
			.map((assigned) => textOf(assigned))
			.join('')
	}
	return [...(el.shadowRoot?.childNodes ?? el.childNodes)]
		.map((child) => textOf(child))
		.join('')
}
const read = (node: Node) => textOf(node).replace(/\s+/g, ' ').trim()

/** The button of a console-button host, inside its shadow root. */
const buttonOf = (host: Element | null | undefined) =>
	host?.shadowRoot?.querySelector('button') as HTMLButtonElement

/** The dialog's choice button: the confirming one, or やめる. */
function choose(dialog: Element, choice: 'confirm' | 'cancel') {
	const buttons = dialog.shadowRoot?.querySelectorAll('console-button')
	const host = [...(buttons ?? [])].find(
		(b) =>
			(b.getAttribute('data-role') === 'confirm') === (choice === 'confirm'),
	)
	buttonOf(host).click()
}

/** The newest snack-bar message. */
const lastMessage = (snackbar: Element) =>
	[...(snackbar.shadowRoot?.querySelectorAll('.snack-message') ?? [])]
		.at(-1)
		?.textContent?.trim()

beforeEach(() => {
	localStorage.clear()
	vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
	vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
	// jsdom has no Popover API or modal dialog; the snack-bar and the confirm
	// dialog use them.
	HTMLElement.prototype.showPopover ??= () => {}
	HTMLElement.prototype.hidePopover ??= () => {}
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
		this.open = true
	}
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
		this.open = false
	}
})
afterEach(() => {
	vi.restoreAllMocks()
})

describe('run an event from the organizer console', () => {
	it(`@spec ${STORY} "Publish declined"`, async () => {
		const publish = vi.fn()
		const fixture = createFixture(
			`<console-snackbar></console-snackbar>
			<confirm-dialog
				heading-key="event.publishConfirmTitle" heading-params.bind="{ title: 'XX 単独公演' }"
				confirm-key="event.publish"
			><p>\${'event.publishConfirmPublic' & t}</p></confirm-dialog>`,
			class {},
			[
				ConsoleI18nConfiguration,
				ConsoleSnackbar,
				ConsoleButton,
				ConfirmDialog,
				Registration.instance(ISeriesClient, {
					list: vi.fn().mockResolvedValue([SOLO]),
					publish,
				}),
				Registration.instance(IOrganizerClient, {
					get: vi.fn().mockResolvedValue(undefined),
				}),
				Registration.instance(IBreadcrumbs, { set: vi.fn() }),
				Registration.instance(IRouter, { load: vi.fn() }),
				Registration.instance(IRouterEvents, {
					subscribe: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				}),
				Registration.instance(IConsoleContext, CONTEXT),
				Registration.instance(IAppConfig, { environment: 'prod' }),
			],
		)
		await fixture.startPromise
		await tasksSettled()
		const vm: EventRoute = fixture.container.invoke(EventRoute)
		await vm.loading({ artistId: 'a-1', seriesId: 's-solo', eventId: 'e-1220' })
		vm.binding()
		const dialog = fixture.appHost.querySelector('confirm-dialog') as Element
		vm.publishDialog = CustomElement.for<ConfirmDialog>(dialog).viewModel

		// 公開する opens the dialog, which says who is told.
		const pending = vm.publish()
		await tasksSettled()
		expect(dialog.shadowRoot?.querySelector('dialog')?.open).toBe(true)
		expect(read(dialog)).toContain('フォロワーに通知します')

		// やめる closes it.
		choose(dialog, 'cancel')
		await pending
		await tasksSettled()

		expect(vm.draft).toBe(true)
		expect(vm.badge.labelKey).toBe('publishState.draft')
		expect(publish).not.toHaveBeenCalled()
		expect(dialog.shadowRoot?.querySelector('dialog')?.open).toBe(false)
		vm.unbinding()
		await fixture.tearDown()
	})

	it(`@spec ${STORY} "Seat type confirmed as fixed"`, async () => {
		const seatTypes: ReturnType<typeof create<typeof SeatTypeSchema>>[] = []
		const createSeatType = vi.fn(
			async (input: { seriesId: string; name: string; price: number }) => {
				const seatType = create(SeatTypeSchema, {
					id: { value: 'seat-1' },
					seriesId: { value: input.seriesId },
					name: { value: input.name },
					price: { value: BigInt(input.price) },
				})
				seatTypes.push(seatType)
				return seatType
			},
		)
		const fixture = createFixture(
			'<console-snackbar></console-snackbar><concert-route></concert-route>',
			class {},
			[
				ConsoleI18nConfiguration,
				...ConsoleFormatters,
				ConsoleSnackbar,
				ConsoleButton,
				ConsoleField,
				ConsoleIcon,
				ConfirmDialog,
				ConcertRoute,
				Registration.instance(ISeriesClient, {
					list: vi.fn().mockResolvedValue([SOLO]),
				}),
				Registration.instance(ITicketSaleClient, {
					listByEvent: vi.fn().mockResolvedValue([]),
				}),
				Registration.instance(ISeatTypeClient, {
					listBySeries: vi.fn(async () => seatTypes),
					create: createSeatType,
				}),
				Registration.instance(ITicketStockClient, {
					listByEvent: vi.fn().mockResolvedValue({ ticketStocks: [] }),
				}),
				Registration.instance(IBreadcrumbs, { set: vi.fn() }),
				Registration.instance(IRouter, { load: vi.fn() }),
				Registration.instance(IConsoleContext, CONTEXT),
			],
		)
		await fixture.startPromise
		const host = fixture.appHost.querySelector('concert-route') as Element
		const vm = CustomElement.for<ConcertRoute>(host).viewModel
		vm.loading({ artistId: 'a-1', seriesId: 's-solo' })
		await vm.load()
		await tasksSettled()
		const snackbar = fixture.appHost.querySelector(
			'console-snackbar',
		) as Element

		// S席 at 8000 yen on the concert page.
		const section = host.querySelector('[data-testid="seat-types"]') as Element
		const type = (field: string, value: string) => {
			const input = section
				.querySelector(`[data-field="${field}"]`)
				?.shadowRoot?.querySelector('input') as HTMLInputElement
			input.value = value
			input.dispatchEvent(new Event('input', { bubbles: true }))
		}
		type('seat-type-name', 'S席')
		type('seat-type-price', '8000')
		await tasksSettled()
		buttonOf(section.querySelector('form console-button')).click()
		await tasksSettled()

		// The dialog says the name and price cannot be changed afterwards.
		const dialog = [...host.querySelectorAll('confirm-dialog')].find(
			(d) => d.shadowRoot?.querySelector('dialog')?.open,
		) as Element
		expect(dialog).toBeTruthy()
		expect(read(dialog)).toContain('S席（8,000円）を追加しますか？')
		expect(read(dialog)).toContain('席種名と価格はあとから変えられません')
		expect(createSeatType).not.toHaveBeenCalled()

		// After confirming, the seat type is created and the snackbar confirms it.
		choose(dialog, 'confirm')
		await vi.waitFor(() => expect(createSeatType).toHaveBeenCalledTimes(1))
		expect(createSeatType).toHaveBeenCalledWith(
			{ seriesId: 's-solo', name: 'S席', price: 8000 },
			expect.anything(),
		)
		await vi.waitFor(() =>
			expect(lastMessage(snackbar)).toBe('S席を追加しました'),
		)
		await vi.waitFor(() =>
			expect(read(section.querySelector('.seat-type') as Element)).toContain(
				'S席',
			),
		)
		expect(read(section.querySelector('.seat-type') as Element)).toContain(
			'8,000円',
		)
		await tasksSettled()
		vm.detaching()
		await fixture.tearDown()
	})

	it(`@spec ${STORY} "Scanner revoked"`, async () => {
		const scanner = (status: ScannerStatus): Scanner =>
			create(ScannerSchema, {
				id: { value: 'scanner-1' },
				number: { value: 1 },
				status,
				linkToken: { value: 'token-1' },
			})
		const revoke = vi.fn().mockResolvedValue(scanner(ScannerStatus.REVOKED))
		const event = create(EventSchema, {
			id: { value: 'e-1220' },
			publishState: PublishState.PUBLISHED,
			localDate: { value: { year: 2026, month: 12, day: 20 } },
			startTime: {
				value: timestampFromDate(new Date('2026-12-20T18:00:00+09:00')),
			},
		})
		const fixture = createFixture(
			'<console-snackbar></console-snackbar><reception-tab></reception-tab>',
			class {},
			[
				ConsoleI18nConfiguration,
				...ConsoleFormatters,
				ConsoleSnackbar,
				ConsoleButton,
				ConsoleIcon,
				ConfirmDialog,
				ListItem,
				StatusBadge,
				ReceptionTab,
				Registration.instance(IEventPage, {
					ready: Promise.resolve(),
					event,
					eventId: 'e-1220',
					seriesId: 's-solo',
				}),
				Registration.instance(IScannerClient, {
					listByEvent: vi
						.fn()
						.mockResolvedValue([scanner(ScannerStatus.UNUSED)]),
					revoke,
				}),
				Registration.instance(IConsoleContext, CONTEXT),
				Registration.instance(IAppConfig, {
					receptionBaseUrl: 'https://reception.e2e.liverty-music.app',
				}),
			],
		)
		await fixture.startPromise
		await tasksSettled()
		const host = fixture.appHost.querySelector('reception-tab') as Element
		const vm = CustomElement.for<ReceptionTab>(host).viewModel
		const snackbar = fixture.appHost.querySelector(
			'console-snackbar',
		) as Element
		const first = () => host.querySelector('[data-scanner="1"]') as Element
		expect(read(first())).toContain('未使用')

		// その他の操作 > 取り消す asks first, naming the device.
		vm.onMenu(vm.rows[0], 'revoke')
		await tasksSettled()
		const dialog = host.querySelector('confirm-dialog') as Element
		expect(read(dialog)).toContain('受付1を取り消しますか？')
		expect(read(dialog)).toContain('受付1を使っている端末は使えなくなります')
		expect(revoke).not.toHaveBeenCalled()
		choose(dialog, 'confirm')

		await vi.waitFor(() => expect(read(first())).toContain('取り消し済み'))
		expect(lastMessage(snackbar)).toBe('受付1を取り消しました')
		// The device stops working because the server revokes the Scanner.
		expect(revoke).toHaveBeenCalledWith('scanner-1')
		await tasksSettled()
		vm.detaching()
		await fixture.tearDown()
	})
})
