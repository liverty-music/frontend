import { IRouteContext, IRouter, IRouterEvents } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { OrganizerSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	ConsoleI18nConfiguration,
	LANGUAGE_STORAGE_KEY,
} from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import ja from '../../../organizer/locales/ja/translation.json'
import { LotterySaleEditorRoute } from '../../../organizer/lottery-sale-editor/lottery-sale-editor-route'
import { IClock } from '../../../organizer/services/clock'
import { IOrganizerClient } from '../../../organizer/services/organizer-client'
import { ISeriesClient } from '../../../organizer/services/series-client'
import { ITicketSaleClient } from '../../../organizer/services/ticket-sale-client'
import { ITicketStockClient } from '../../../organizer/services/ticket-stock-client'
import { IBreadcrumbs } from '../../../organizer/shell/breadcrumbs'
import { ConsoleBreadcrumb } from '../../../organizer/shell/console-breadcrumb/console-breadcrumb'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { CrumbText } from '../../../organizer/shell/crumb-text/crumb-text'
import { ActionBar } from '../../../organizer/ui/action-bar/action-bar'
import { ConfirmDialog } from '../../../organizer/ui/confirm-dialog/confirm-dialog'
import { ConsoleButton } from '../../../organizer/ui/console-button/console-button'
import { ConsoleField } from '../../../organizer/ui/console-field/console-field'
import { ConsoleIcon } from '../../../organizer/ui/console-icon/console-icon'
import { ISnackbar } from '../../../organizer/ui/console-snackbar/snackbar'
import { ConsoleTimeField } from '../../../organizer/ui/console-time-field/console-time-field'
import { PrerequisiteCallout } from '../../../organizer/ui/prerequisite-callout/prerequisite-callout'
import { UnsavedChanges } from '../../../organizer/ui/unsaved-changes/unsaved-changes'
import {
	COMPLETE_ORGANIZER,
	controlsNamed,
	deepAll,
	deepOne,
	deepText,
	eventInit,
	jst,
	organizerWithout,
	S_SEAT,
	stocksOf,
	stubBrowserOverlays,
	ticketSale,
	tourWith,
} from '../event/event-tab-support'

const SPEC = 'components/infrastructure/organizer/web/route/ticket-sale-editor'
const SNACKBAR = 'components/infrastructure/organizer/web/global/snack-bar'
const EVENT_SPEC = 'components/infrastructure/organizer/web/route/event'
const I18N = 'components/infrastructure/organizer/web/global/i18n'

type Route = InstanceType<typeof LotterySaleEditorRoute>

/** Thursday 1 October 2026, 12:00 JST: the clock of every test. */
const NOW = jst('2026-10-01', '12:00').getTime()
const SALES_HREF =
	'/organizers/org-1/artists/a-1/series/s-tour/events/e-1103/ticket-sales'

/** An unopened lottery for 3 November: 10 to 17 October. */
function presale() {
	return ticketSale({
		id: 'l-1',
		name: 'ファンクラブ先行',
		start: jst('2026-10-10', '12:00'),
		end: jst('2026-10-17', '12:00'),
	})
}

interface Doubles {
	list: ReturnType<typeof vi.fn>
	getOrganizer: ReturnType<typeof vi.fn>
	listByEvent: ReturnType<typeof vi.fn>
	create: ReturnType<typeof vi.fn>
	setWindow: ReturnType<typeof vi.fn>
	listStocks: ReturnType<typeof vi.fn>
	load: ReturnType<typeof vi.fn>
	show: ReturnType<typeof vi.fn>
	showError: ReturnType<typeof vi.fn>
	/** What the clock reads, in epoch milliseconds. */
	now: number
	saleId: string
	/** Renders the console's own breadcrumb instead of a stub. */
	withTrail: boolean
}

function doubles(over: Partial<Doubles>): Doubles {
	return {
		list: vi.fn().mockResolvedValue([tourWith(eventInit())]),
		getOrganizer: vi
			.fn()
			.mockResolvedValue(create(OrganizerSchema, COMPLETE_ORGANIZER)),
		listByEvent: vi.fn().mockResolvedValue({ ticketSales: [] }),
		create: vi.fn().mockResolvedValue(undefined),
		setWindow: vi.fn(),
		listStocks: vi
			.fn()
			.mockResolvedValue(
				stocksOf([{ id: 'stock-s', seat: S_SEAT, quantity: 100 }]),
			),
		load: vi.fn().mockResolvedValue(undefined),
		show: vi.fn(),
		showError: vi.fn(),
		now: NOW,
		saleId: '',
		withTrail: false,
		...over,
	}
}

async function mount(
	over: Partial<Doubles> = {},
	settled: Route['state'] = 'ready',
) {
	const d = doubles(over)
	const fixture = createFixture(
		'<console-breadcrumb></console-breadcrumb><lottery-sale-editor-route></lottery-sale-editor-route>',
		class {},
		[
			ConsoleI18nConfiguration,
			...ConsoleFormatters,
			ActionBar,
			ConfirmDialog,
			ConsoleBreadcrumb,
			ConsoleButton,
			ConsoleField,
			ConsoleIcon,
			ConsoleTimeField,
			CrumbText,
			PrerequisiteCallout,
			UnsavedChanges,
			LotterySaleEditorRoute,
			Registration.instance(ISeriesClient, { list: d.list }),
			Registration.instance(IOrganizerClient, { get: d.getOrganizer }),
			Registration.instance(ITicketSaleClient, {
				listByEvent: d.listByEvent,
				create: d.create,
				setWindow: d.setWindow,
			}),
			Registration.instance(ITicketStockClient, { listByEvent: d.listStocks }),
			Registration.instance(IRouter, { load: d.load }),
			Registration.instance(IRouteContext, {
				getRouteParameters: () => ({
					seriesId: 's-tour',
					eventId: 'e-1103',
					...(d.saleId ? { saleId: d.saleId } : {}),
				}),
			}),
			...(d.withTrail
				? [Registration.instance(IRouterEvents, { subscribe: vi.fn() })]
				: [Registration.instance(IBreadcrumbs, { set: vi.fn() })]),
			Registration.instance(IConsoleContext, {
				scope: { organizer: 'org-1', artist: 'a-1' },
			}),
			// The clock is read at every call, so a test may let time pass.
			Registration.instance(IClock, { now: () => d.now }),
			Registration.instance(ISnackbar, {
				show: d.show,
				showError: d.showError,
			}),
		],
	)
	await fixture.startPromise
	const host = fixture.appHost.querySelector('lottery-sale-editor-route')
	if (!host) throw new Error('lottery-sale-editor-route did not render')
	const vm = CustomElement.for<Route>(host).viewModel
	await vi.waitFor(() => expect(vm.state).toBe(settled))
	await tasksSettled()
	/** The console-field or time field of the form that is labelled `label`. */
	const fieldLabelled = (label: string): HTMLElement => {
		const found = [
			...host.querySelectorAll<HTMLElement>(
				'console-field, console-time-field',
			),
		].find((f) => {
			const el = CustomElement.for<ConsoleField>(f).viewModel
			return el.label === label
		})
		if (!found) throw new Error(`no field labelled ${label}`)
		return found
	}
	const save = async () => {
		await vm.save()
		await tasksSettled()
	}
	return { fixture, vm, host, d, fieldLabelled, save }
}

function createInput(d: Doubles) {
	return d.create.mock.calls[0]?.[0] as {
		seriesId: string
		name: string
		method: string
		saleStartTime: Date
		saleEndTime: Date
		eventIds: string[]
	}
}

describe('lottery sale editor', () => {
	beforeEach(() => {
		localStorage.clear()
		localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ja')
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
		stubBrowserOverlays()
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('a new lottery', () => {
		it(`@spec ${SPEC} "Blank lottery form"`, async () => {
			const { fixture, host, fieldLabelled } = await mount()

			expect(host.querySelector('h1')?.textContent?.trim()).toBe(
				'抽選で販売する',
			)
			const shown = (date: string, time: string) => {
				const hours = deepAll<HTMLSelectElement>(fieldLabelled(time), 'select')
				return `${deepOne<HTMLInputElement>(fieldLabelled(date), 'input')?.value} ${hours[0].value}:${hours[1].value}`
			}
			expect(shown('受付開始日', '受付開始時刻')).toBe('2026-10-01 12:00')
			expect(shown('受付終了日', '受付終了時刻')).toBe('2026-10-11 12:00')
			// No price, quantity or limit: those are the event's.
			const labels = [...host.querySelectorAll('console-field')].map(
				(f) => CustomElement.for<ConsoleField>(f).viewModel.label,
			)
			expect(labels).not.toContain('価格')
			expect(labels).not.toContain('1人あたりの上限枚数')
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Window too long"`, async () => {
			const { fixture, vm, d, fieldLabelled, save } = await mount()
			vm.model = {
				name: 'ファンクラブ先行',
				saleStart: { date: '2026-10-01', time: '12:00' },
				saleEnd: { date: '2026-10-16', time: '12:00' },
			}

			await save()

			expect(deepText(fieldLabelled('受付終了日'))).toContain(
				'受付期間は1〜14日にしてください',
			)
			expect(d.create).not.toHaveBeenCalled()
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Presale for one event"`, async () => {
			const { fixture, vm, host, d, save } = await mount({
				create: vi.fn().mockResolvedValue(presale()),
			})
			// It draws from the event's S席, up to the event's limit.
			const tickets = host.querySelector('.tickets') as HTMLElement
			expect(
				[...tickets.querySelectorAll('.stock')].map((li) =>
					li.textContent?.replace(/\s+/g, ' ').trim(),
				),
			).toEqual(['S席 8,000円 税込 · 100枚'])
			expect(tickets.textContent).toContain('1アカウント4枚まで')
			vm.model.name = 'ファンクラブ先行'

			await save()

			expect(d.create).toHaveBeenCalledTimes(1)
			const input = createInput(d)
			expect(input.name).toBe('ファンクラブ先行')
			expect(input.method).toBe('lottery')
			expect(input.saleStartTime.toISOString()).toBe(
				jst('2026-10-01', '12:00').toISOString(),
			)
			expect(input.saleEndTime.toISOString()).toBe(
				jst('2026-10-11', '12:00').toISOString(),
			)
			expect(input.eventIds).toEqual(['e-1103'])
			expect(input.seriesId).toBe('s-tour')
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Missing name"`, async () => {
			const { fixture, d, fieldLabelled, save } = await mount()

			await save()

			expect(deepText(fieldLabelled('販売名'))).toContain(
				'販売名を入力してください',
			)
			expect(d.create).not.toHaveBeenCalled()
			await fixture.tearDown()
		})

		it(`@spec ${SNACKBAR} "Missing sale name"`, async () => {
			const { fixture, d, fieldLabelled, save } = await mount()

			await save()

			const name = fieldLabelled('販売名')
			expect(deepText(name)).toContain('販売名を入力してください')
			expect(deepOne(name, 'input')?.getAttribute('aria-invalid')).toBe('true')
			// The error is inline, next to the field, and not a snack bar message.
			expect(d.show).not.toHaveBeenCalled()
			expect(d.showError).not.toHaveBeenCalled()
			expect(d.create).not.toHaveBeenCalled()
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Overlapping window"`, async () => {
			const { fixture, vm, d, fieldLabelled, save } = await mount({
				listByEvent: vi.fn().mockResolvedValue({
					ticketSales: [
						ticketSale({
							id: 'l-early',
							name: '最速先行',
							start: jst('2026-10-01', '00:00'),
							end: jst('2026-10-05', '23:59'),
						}),
					],
				}),
			})
			vm.model = {
				name: 'ファンクラブ先行',
				saleStart: { date: '2026-10-04', time: '12:00' },
				saleEnd: { date: '2026-10-14', time: '12:00' },
			}

			await save()

			const text = deepText(fieldLabelled('受付終了日'))
			expect(text).toContain('販売「最速先行」')
			expect(text).toContain('と期間が重なっています')
			expect(d.create).not.toHaveBeenCalled()
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Breadcrumb"`, async () => {
			const { fixture } = await mount({ withTrail: true })

			const trail = fixture.appHost.querySelector(
				'nav[aria-label="パンくずリスト"]',
			)
			expect(trail, 'the console breadcrumb renders the trail').not.toBeNull()
			expect(
				[...(trail?.querySelectorAll('li') ?? [])].map((li) =>
					li.textContent?.trim(),
				),
			).toEqual(['公演', 'XX Tour 2026', '11月3日(火)', '抽選で販売'])
			expect(
				[...(trail?.querySelectorAll('a') ?? [])]
					.find((a) => a.textContent?.includes('11月3日(火)'))
					?.getAttribute('href'),
			).toBe(SALES_HREF)
			await fixture.tearDown()
		})
	})

	describe('what blocks the form', () => {
		it(`@spec ${SPEC} "Start time not set"`, async () => {
			const { fixture, host, fieldLabelled } = await mount(
				{
					list: vi
						.fn()
						.mockResolvedValue([tourWith(eventInit({ start: null }))]),
				},
				'blocked',
			)

			const callout = host.querySelector('prerequisite-callout') as HTMLElement
			const text = deepText(callout)
			expect(text).toContain('開始時刻を設定してください')
			expect(text).toContain('販売を始めるには、公演日の開始時刻が必要です。')
			expect(
				deepAll(callout, 'a')
					.filter((a) => a.textContent?.trim() === '公演を編集')
					.map((a) => a.getAttribute('href')),
			).toEqual(['/organizers/org-1/artists/a-1/series/s-tour/edit'])
			expect(deepOne(callout, 'a.guide')?.getAttribute('href')).toBe(
				'/guide.html#publish',
			)
			expect(controlsNamed(host, '抽選販売を始める')).toHaveLength(0)
			expect(() => fieldLabelled('販売名')).toThrow()
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Business details incomplete"`, async () => {
			const { fixture, host, fieldLabelled } = await mount(
				{
					getOrganizer: vi
						.fn()
						.mockResolvedValue(organizerWithout('businessPhoneNumber')),
				},
				'blocked',
			)

			const callout = host.querySelector('prerequisite-callout') as HTMLElement
			const text = deepText(callout)
			expect(text).toContain('事業者情報が未登録です')
			expect(text).toContain('審査のときに Liverty Music が登録します')
			expect(deepOne(callout, 'a.guide')?.getAttribute('href')).toBe(
				'/guide.html#business-and-payout',
			)
			expect(controlsNamed(host, '抽選販売を始める')).toHaveLength(0)
			expect(() => fieldLabelled('販売名')).toThrow()
			await fixture.tearDown()
		})

		it('says the event must be published first, with the guide', async () => {
			const { fixture, host } = await mount(
				{
					list: vi
						.fn()
						.mockResolvedValue([
							tourWith(eventInit({ publishState: PublishState.DRAFT })),
						]),
				},
				'blocked',
			)

			const callout = host.querySelector('prerequisite-callout') as HTMLElement
			expect(deepText(callout)).toContain(
				'販売を始めるには、公演を公開してください',
			)
			expect(
				deepAll(callout, 'a')
					.filter((a) => a.textContent?.trim() === '販売へ戻る')
					.map((a) => a.getAttribute('href')),
			).toEqual([SALES_HREF])
			expect(deepOne(callout, 'a.guide')?.getAttribute('href')).toBe(
				'/guide.html#publish',
			)
			expect(controlsNamed(host, '抽選販売を始める')).toHaveLength(0)
			await fixture.tearDown()
		})
	})

	describe('times in another time zone', () => {
		it(`@spec ${SPEC} "Device in another time zone"`, async () => {
			// The window is entered in Japan time whatever the device's zone; the
			// device's own zone is exercised in japan-time.node.spec.ts.
			const { fixture, vm, d, fieldLabelled, save } = await mount({
				create: vi.fn().mockResolvedValue(presale()),
			})
			vm.model = {
				name: 'ファンクラブ先行',
				saleStart: { date: '2026-10-10', time: '12:00' },
				saleEnd: { date: '2026-10-17', time: '12:00' },
			}
			await tasksSettled()

			const start = fieldLabelled('受付開始時刻')
			expect(deepText(start)).toContain('JST')
			// Hours 00 to 23 on the 24-hour clock, whatever the device's clock.
			expect(
				deepAll<HTMLSelectElement>(start, 'select')[0].options,
			).toHaveLength(24)
			expect(
				[...deepAll<HTMLOptionElement>(start, 'option')].filter(
					(o) => o.textContent?.trim() === '23',
				),
			).toHaveLength(1)

			await save()

			const input = createInput(d)
			// 12:00 JST on 10 October is 03:00 UTC.
			expect(input.saleStartTime.toISOString()).toBe('2026-10-10T03:00:00.000Z')
			expect(input.saleEndTime.toISOString()).toBe('2026-10-17T03:00:00.000Z')
			await fixture.tearDown()
		})

		it(`@spec ${I18N} "Device on a 12-hour clock"`, async () => {
			// An English (United States) device writes 18:00 as 6:00 PM.
			vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US', 'en'])
			vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
			const { fixture, fieldLabelled } = await mount()
			expect(
				new Date(2026, 9, 10, 18).toLocaleTimeString('en-US', {
					hour: 'numeric',
					minute: '2-digit',
				}),
			).toMatch(/PM/)

			const start = fieldLabelled('受付開始時刻')
			const [hours, minutes] = deepAll<HTMLSelectElement>(start, 'select')
			const texts = (select: HTMLSelectElement) =>
				[...select.options]
					.map((o) => o.textContent?.trim() ?? '')
					.filter((t) => t !== '--')
			const two = (n: number) => String(n).padStart(2, '0')
			expect(texts(hours)).toEqual(Array.from({ length: 24 }, (_, h) => two(h)))
			expect(texts(minutes)).toEqual(
				Array.from({ length: 12 }, (_, i) => two(i * 5)),
			)
			expect(deepText(start)).not.toMatch(/AM|PM|午前|午後/)
			await fixture.tearDown()
		})
	})

	describe('changing a lottery before it opens', () => {
		const MOVED_START = jst('2026-10-12', '12:00')
		const MOVED_END = jst('2026-10-19', '12:00')

		it(`@spec ${SPEC} "Move the window before it opens"`, async () => {
			const moved = ticketSale({
				id: 'l-1',
				name: 'ファンクラブ先行',
				start: MOVED_START,
				end: MOVED_END,
			})
			const { fixture, vm, host, d, fieldLabelled, save } = await mount({
				saleId: 'l-1',
				listByEvent: vi.fn().mockResolvedValue({ ticketSales: [presale()] }),
				setWindow: vi.fn().mockResolvedValue(moved),
			})

			expect(host.querySelector('h1')?.textContent?.trim()).toBe(
				'抽選販売を変更',
			)
			// The name is shown, not edited; the window opens as saved.
			expect(host.querySelector('.fixed')?.textContent).toContain(
				'ファンクラブ先行',
			)
			expect(() => fieldLabelled('販売名')).toThrow()
			expect(
				deepOne<HTMLInputElement>(fieldLabelled('受付開始日'), 'input')?.value,
			).toBe('2026-10-10')
			expect(vm.model.saleStart).toEqual({ date: '2026-10-10', time: '12:00' })

			vm.model.saleStart = { date: '2026-10-12', time: '12:00' }
			vm.model.saleEnd = { date: '2026-10-19', time: '12:00' }
			await save()

			expect(d.setWindow).toHaveBeenCalledTimes(1)
			const [id, start, end] = d.setWindow.mock.calls[0]
			expect(id).toBe('l-1')
			expect(start.toISOString()).toBe(MOVED_START.toISOString())
			expect(end.toISOString()).toBe(MOVED_END.toISOString())
			expect(d.create).not.toHaveBeenCalled()
			expect(d.show).toHaveBeenCalledWith('lotteryEditor.changed')
			expect(d.load).toHaveBeenCalledWith(SALES_HREF)
			await fixture.tearDown()
		})

		it(`@spec ${EVENT_SPEC} "Edit a lottery before it opens"`, async () => {
			const { fixture, host, fieldLabelled } = await mount({
				saleId: 'sale-tomorrow',
				now: jst('2026-10-08', '09:00').getTime(),
				listByEvent: vi.fn().mockResolvedValue({
					ticketSales: [
						ticketSale({
							id: 'sale-tomorrow',
							name: 'ファンクラブ先行',
							start: jst('2026-10-09', '12:00'),
							end: jst('2026-10-16', '23:59'),
						}),
					],
				}),
			})

			expect(host.querySelector('h1')?.textContent?.trim()).toBe(
				'抽選販売を変更',
			)
			const shown = (date: string, time: string) => {
				const parts = deepAll<HTMLSelectElement>(fieldLabelled(time), 'select')
				return `${deepOne<HTMLInputElement>(fieldLabelled(date), 'input')?.value} ${parts[0].value}:${parts[1].value}`
			}
			expect(shown('受付開始日', '受付開始時刻')).toBe('2026-10-09 12:00')
			// A minute off the 5-minute steps is shown as saved.
			expect(shown('受付終了日', '受付終了時刻')).toBe('2026-10-16 23:59')
			expect(host.querySelector('.fixed')?.textContent).toContain(
				'ファンクラブ先行',
			)
			await fixture.tearDown()
		})

		it(`@spec ${SPEC} "Sale opened while editing"`, async () => {
			const { fixture, vm, host, d, save } = await mount({
				saleId: 'l-1',
				listByEvent: vi.fn().mockResolvedValue({ ticketSales: [presale()] }),
			})
			vm.model.saleStart = { date: '2026-10-12', time: '12:00' }
			// The window opens while the member is still editing.
			d.now = jst('2026-10-10', '12:30').getTime()

			await save()

			expect(host.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
				'受付が始まった抽選は変更できません。何も保存していません。',
			)
			expect(d.setWindow).not.toHaveBeenCalled()
			expect(d.load).not.toHaveBeenCalled()
			await fixture.tearDown()
		})
	})
})
