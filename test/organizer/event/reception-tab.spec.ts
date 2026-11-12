import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import {
	ScannerSchema,
	ScannerStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/scanner_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IEventPage } from '../../../organizer/event/event-page'
import { ReceptionTab } from '../../../organizer/event/reception-tab/reception-tab'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import { IScannerClient } from '../../../organizer/services/scanner-client'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { ConfirmDialog } from '../../../organizer/ui/confirm-dialog/confirm-dialog'
import { ConsoleButton } from '../../../organizer/ui/console-button/console-button'
import { ConsoleIcon } from '../../../organizer/ui/console-icon/console-icon'
import { ISnackbar } from '../../../organizer/ui/console-snackbar/snackbar'
import { CopyButton } from '../../../organizer/ui/copy-button/copy-button'
import { IconButton } from '../../../organizer/ui/icon-button/icon-button'
import { ListItem } from '../../../organizer/ui/list-item/list-item'
import { OverflowMenu } from '../../../organizer/ui/overflow-menu/overflow-menu'
import { PrerequisiteCallout } from '../../../organizer/ui/prerequisite-callout/prerequisite-callout'
import { StatusBadge } from '../../../organizer/ui/status-badge/status-badge'
import { IAppConfig } from '../../../shared/config/app-config'
import {
	controlsNamed,
	deepAll,
	deepOne,
	deepText,
	eventInit,
	jst,
	stubBrowserOverlays,
	tourWith,
} from './event-tab-support'

const SPEC = 'components/infrastructure/organizer/web/route/event'
const ORIGIN = 'https://reception.e2e.liverty-music.app'

interface ScannerInit {
	id: string
	number: number
	status: ScannerStatus
	token?: string
	bindTime?: Date
}

function scanner(init: ScannerInit) {
	return create(ScannerSchema, {
		id: { value: init.id },
		eventId: { value: 'e-1103' },
		number: { value: init.number },
		status: init.status,
		...(init.token ? { linkToken: { value: init.token } } : {}),
		...(init.bindTime ? { bindTime: timestampFromDate(init.bindTime) } : {}),
	})
}

interface Doubles {
	event: ReturnType<typeof tourWith>['events'][number] | undefined
	scanners: ScannerInit[]
	create: ReturnType<typeof vi.fn>
	revoke: ReturnType<typeof vi.fn>
	requestPublish: ReturnType<typeof vi.fn>
	show: ReturnType<typeof vi.fn>
}

/** The Reception tab of the 3 November event, with the clients stubbed. */
async function mount(over: Partial<Doubles> = {}) {
	const d: Doubles = {
		event: tourWith(eventInit()).events[0],
		scanners: [],
		create: vi.fn(),
		revoke: vi.fn(),
		requestPublish: vi.fn(),
		show: vi.fn(),
		...over,
	}
	const listByEvent = vi
		.fn()
		.mockResolvedValue(d.scanners.map((s) => scanner(s)))
	const page = {
		ready: Promise.resolve(),
		event: d.event,
		eventId: 'e-1103',
		seriesId: 's-tour',
		requestPublish: d.requestPublish,
	}
	const fixture = createFixture('<reception-tab></reception-tab>', class {}, [
		ConsoleI18nConfiguration,
		...ConsoleFormatters,
		ConfirmDialog,
		ConsoleButton,
		ConsoleIcon,
		CopyButton,
		IconButton,
		ListItem,
		OverflowMenu,
		PrerequisiteCallout,
		StatusBadge,
		ReceptionTab,
		Registration.instance(IEventPage, page),
		Registration.instance(IScannerClient, {
			listByEvent,
			create: d.create,
			revoke: d.revoke,
		}),
		Registration.instance(IConsoleContext, {
			scope: { organizer: 'org-1', artist: 'a-1' },
		}),
		Registration.instance(IAppConfig, {
			environment: 'prod',
			receptionBaseUrl: ORIGIN,
		}),
		Registration.instance(ISnackbar, {
			show: d.show,
			showError: vi.fn(),
		}),
	])
	await fixture.startPromise
	await tasksSettled()
	const tab = fixture.appHost.querySelector('reception-tab') as HTMLElement
	const row = (n: number) =>
		tab.querySelector<HTMLElement>(`[data-scanner="${n}"]`)
	const issueButton = () => controlsNamed(tab, '受付リンクを発行')[0]
	const settle = async () => {
		await vi.waitFor(() => tasksSettled())
		await new Promise((r) => setTimeout(r, 0))
		await tasksSettled()
	}
	return { fixture, d, tab, row, issueButton, settle, listByEvent }
}

describe('event page Reception tab', () => {
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
		stubBrowserOverlays()
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it(`@spec ${SPEC} "Issue two scanners"`, async () => {
		const written: string[] = []
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: async (text: string) => {
					written.push(text)
				},
			},
		})
		let next = 1
		const create_ = vi.fn().mockImplementation(async () => {
			const n = next++
			return scanner({
				id: `scanner-${n}`,
				number: n,
				status: ScannerStatus.UNUSED,
				token: `token-${n}`,
			})
		})
		const { fixture, tab, row, issueButton, settle } = await mount({
			create: create_,
		})

		expect(deepText(tab)).toContain('まだ受付リンクがありません')
		expect(deepText(tab)).toContain(
			'各リンクは、最初に開いた1台の端末でだけ使えます。',
		)
		expect(
			tab.querySelector('a.guide')?.getAttribute('target'),
			'the staff guide opens in a new tab',
		).toBe('_blank')
		// 受付リンクを発行 is a tonal button.
		expect(
			deepOne(issueButton(), '[data-variant]')?.getAttribute('data-variant'),
		).toBe('tonal')

		issueButton().click()
		await settle()
		issueButton().click()
		await settle()

		expect(create_.mock.calls.map((c) => c[0])).toEqual(['e-1103', 'e-1103'])
		for (const n of [1, 2]) {
			const r = row(n) as HTMLElement
			expect(deepText(r)).toContain(`受付${n}`)
			expect(deepText(deepOne(r, 'status-badge') as HTMLElement)).toBe('未使用')
			// The token is in the fragment of a link on the reception origin.
			expect(deepText(r)).toContain(`${ORIGIN}/#token-${n}`)
			const copy = deepOne(r, 'copy-button') as HTMLElement
			expect(
				deepOne(copy, 'button')?.getAttribute('aria-label'),
				`row ${n} has its copy button`,
			).toBe(`受付${n}をコピー`)
		}

		const copy2 = deepOne(row(2) as HTMLElement, 'copy-button') as HTMLElement
		deepOne<HTMLButtonElement>(copy2, 'button')?.click()
		await settle()
		expect(written).toEqual([`${ORIGIN}/#token-2`])
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "Scanner opened by staff"`, async () => {
		const { fixture, row } = await mount({
			scanners: [
				{
					id: 'scanner-1',
					number: 1,
					status: ScannerStatus.IN_USE,
					token: 'token-1',
					bindTime: jst('2026-11-03', '14:10'),
				},
			],
		})

		const r = row(1) as HTMLElement
		expect(deepText(deepOne(r, 'status-badge') as HTMLElement)).toBe('使用中')
		expect(deepText(r)).toContain('14:10 JST')
		expect(deepText(r)).not.toContain('token-1')
		expect(deepAll(r, 'copy-button')).toHaveLength(0)
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "Staff changed phones"`, async () => {
		const revoke = vi.fn().mockResolvedValue(
			scanner({
				id: 'scanner-1',
				number: 1,
				status: ScannerStatus.REVOKED,
			}),
		)
		const create_ = vi.fn().mockResolvedValue(
			scanner({
				id: 'scanner-3',
				number: 3,
				status: ScannerStatus.UNUSED,
				token: 'token-3',
			}),
		)
		const { fixture, row, settle } = await mount({
			scanners: [
				{
					id: 'scanner-1',
					number: 1,
					status: ScannerStatus.IN_USE,
					bindTime: jst('2026-11-03', '14:10'),
				},
				{
					id: 'scanner-2',
					number: 2,
					status: ScannerStatus.UNUSED,
					token: 'token-2',
				},
			],
			revoke,
			create: create_,
		})

		// The actions are in the item's overflow menu, not beside the item.
		const menu = deepOne(row(1) as HTMLElement, 'overflow-menu') as HTMLElement
		expect(controlsNamed(row(1) as HTMLElement, '取り消して再発行')).toEqual(
			controlsNamed(menu, '取り消して再発行'),
		)
		const choose = deepOne<HTMLElement>(
			menu,
			'[data-item="reissue"]',
		) as HTMLElement
		expect(deepText(choose)).toBe('取り消して再発行')
		// The menu hands its choice to the tab as a `select` event.
		menu.dispatchEvent(
			new CustomEvent('select', { detail: 'reissue', bubbles: true }),
		)
		await settle()

		const dialog = deepOne(
			row(1)?.closest('reception-tab') as HTMLElement,
			'confirm-dialog',
		) as HTMLElement
		const dialogText = deepText(dialog)
		expect(dialogText).toContain('受付1を取り消して再発行しますか？')
		expect(dialogText).toContain('受付1を使っている端末は使えなくなります。')
		expect(revoke).not.toHaveBeenCalled()
		deepOne<HTMLElement>(dialog, '[data-role="confirm"]')?.click()
		await settle()

		expect(
			deepText(deepOne(row(1) as HTMLElement, 'status-badge') as HTMLElement),
		).toBe('取り消し済み')
		expect(
			deepText(deepOne(row(3) as HTMLElement, 'status-badge') as HTMLElement),
		).toBe('未使用')
		expect(deepText(row(3) as HTMLElement)).toContain(`${ORIGIN}/#token-3`)
		expect(
			deepOne(
				deepOne(row(3) as HTMLElement, 'copy-button') as HTMLElement,
				'button',
			)?.getAttribute('aria-label'),
		).toBe('受付3をコピー')
		// A revoked Scanner offers no more actions.
		expect(deepAll(row(1) as HTMLElement, 'overflow-menu')).toHaveLength(0)
		expect(deepAll(row(3) as HTMLElement, 'overflow-menu')).toHaveLength(1)
		expect(revoke).toHaveBeenCalledWith('scanner-1')
		expect(create_).toHaveBeenCalledWith('e-1103')
		expect(revoke.mock.invocationCallOrder[0]).toBeLessThan(
			create_.mock.invocationCallOrder[0],
		)
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "Unpublished event"`, async () => {
		const { fixture, tab, d, issueButton, listByEvent } = await mount({
			event: tourWith(eventInit({ publishState: PublishState.DRAFT }))
				.events[0],
		})

		const callout = deepOne(tab, 'prerequisite-callout') as HTMLElement
		expect(deepText(callout)).toContain(
			'受付リンクを発行するには、公演を公開してください',
		)
		const publish = controlsNamed(callout, '公開する')[0]
		expect(publish, 'the callout offers 公開する').toBeDefined()
		const guide = deepOne(callout, 'a.guide')
		expect(guide?.getAttribute('href')).toBe('/guide.html#publish')
		expect(guide?.getAttribute('target')).toBe('_blank')
		expect(guide?.getAttribute('rel')).toBe('noopener')
		expect(issueButton()).toBeUndefined()
		expect(listByEvent).not.toHaveBeenCalled()

		// The link opens the event's publish confirmation.
		publish.click()
		expect(d.requestPublish).toHaveBeenCalledTimes(1)
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "Event without a start time"`, async () => {
		const { fixture, tab, issueButton } = await mount({
			event: tourWith(eventInit({ start: null })).events[0],
		})

		const callout = deepOne(tab, 'prerequisite-callout') as HTMLElement
		const text = deepText(callout)
		expect(text).toContain('開始時刻を設定してください')
		expect(text).toContain(
			'受付リンクを発行するには、公演日の開始時刻が必要です。',
		)
		const edit = controlsNamed(callout, '公演を編集')[0]
		expect(
			deepOne(edit, 'a')?.getAttribute('href') ?? edit.getAttribute('href'),
		).toBe('/organizers/org-1/artists/a-1/series/s-tour/edit')
		expect(deepOne(callout, 'a.guide')?.getAttribute('href')).toBe(
			'/guide.html#publish',
		)
		expect(issueButton()).toBeUndefined()
		await fixture.tearDown()
	})
})
