import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { OrganizerSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { Visibility } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConcertEditorRoute } from '../../../organizer/concert-editor/concert-editor-route'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import { IArtistClient } from '../../../organizer/services/artist-client'
import { IOrganizerClient } from '../../../organizer/services/organizer-client'
import { ISeriesClient } from '../../../organizer/services/series-client'
import { ISeriesImageClient } from '../../../organizer/services/series-image-client'
import { IVenueClient } from '../../../organizer/services/venue-client'
import { IBreadcrumbs } from '../../../organizer/shell/breadcrumbs'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { ConsoleUi } from '../../../organizer/ui'
import type { ConsoleTimeField } from '../../../organizer/ui/console-time-field/console-time-field'
import type { VenueField } from '../../../organizer/ui/venue-field/venue-field'
import {
	artistsNamed,
	authored,
	type ConcertSpec,
	XX_SOLO,
	XX_TOUR,
} from '../concert-fixtures'
import {
	controlNamed,
	deepAll,
	deepOne,
	deepText,
	fieldNamed,
	fillField,
	installDialogAndPopover,
} from '../console-dom'

/**
 * The concert editor as the member uses it: the real route template and the
 * console's components (venue field, time fields, action bar), with the
 * series, artist, venue and image clients faked. Reading the saved values on
 * the concert page, the unsaved-changes guard on a navigation click and the
 * brand colour are checked in `e2e/functional/organizer-concert-editor.spec.ts`.
 */

const SPEC = 'components/infrastructure/organizer/web/route/concert-editor'

// The first test of the file compiles the route, its templates and the console
// components, which takes longer than the default 5 s on a loaded machine.
vi.setConfig({ testTimeout: 30_000 })

// The past-date rule reads the clock; the editor is checked on Thursday 1 October
// 2026, so every fixture date is in the future.
vi.mock('../../../organizer/concert-editor/concert-form', async (original) => {
	const actual =
		await original<
			typeof import('../../../organizer/concert-editor/concert-form')
		>()
	return {
		...actual,
		validateConcertForm: (
			model: Parameters<typeof actual.validateConcertForm>[0],
			options?: Parameters<typeof actual.validateConcertForm>[1],
		) =>
			actual.validateConcertForm(model, {
				today: { year: 2026, month: 10, day: 1 },
				...options,
			}),
	}
})

const HANEDA = {
	placeId: 'ChIJ-haneda',
	name: 'Zepp Haneda (TOKYO)',
	address: '大田区羽田空港',
}

/** XX Tour 2026 with every date matched to a map place. */
const TOUR: ConcertSpec = {
	...XX_TOUR,
	events: XX_TOUR.events.map((e) => ({
		...e,
		placeId: e.placeId ?? `ChIJ-${e.id}`,
	})),
}

const BAND_A_HREF = '/organizers/org-1/artists/a-1/series'

interface Options {
	/** The series being edited; none for a new concert. */
	edit?: ConcertSpec
	/** The artist the editor is opened under. */
	artist?: string
	update?: ReturnType<typeof vi.fn>
	list?: ReturnType<typeof vi.fn>
	seriesImages?: Record<string, ReturnType<typeof vi.fn>>
	setCoverImage?: ReturnType<typeof vi.fn>
}

async function mount(opts: Options = {}) {
	const concerts = [authored(XX_SOLO), authored(TOUR)]
	const list = opts.list ?? vi.fn(async () => concerts)
	const created = authored({
		id: 's-new',
		title: 'XX 冬の単独公演',
		performers: [{ id: 'a-1', name: 'Band A' }],
		events: [{ id: 'e-1201', date: '2026-12-01', venue: HANEDA.name }],
	})
	const createSeries = vi.fn(async () => created)
	const update = opts.update ?? vi.fn(async () => undefined)
	const setCoverImage = opts.setCoverImage ?? vi.fn(async () => undefined)
	const search = vi.fn(async () => [HANEDA])
	const load = vi.fn()
	const fixture = createFixture(
		'<console-snackbar></console-snackbar><concert-editor-route></concert-editor-route>',
		class {},
		[
			ConsoleI18nConfiguration,
			...ConsoleFormatters,
			...ConsoleUi,
			ConcertEditorRoute,
			Registration.instance(ISeriesClient, {
				list,
				create: createSeries,
				update,
				setCoverImage,
			}),
			Registration.instance(ISeriesImageClient, opts.seriesImages ?? {}),
			Registration.instance(IVenueClient, { search }),
			Registration.instance(IArtistClient, {
				list: vi.fn(async () => artistsNamed('Band A', 'Band B')),
			}),
			Registration.instance(IOrganizerClient, {
				get: vi
					.fn()
					.mockResolvedValue(
						create(OrganizerSchema, { id: { value: 'org-1' } }),
					),
			}),
			Registration.instance(IBreadcrumbs, { set: vi.fn() }),
			Registration.instance(IRouter, { load }),
		],
	)
	await fixture.startPromise
	const host = fixture.appHost.querySelector(
		'concert-editor-route',
	) as HTMLElement
	const vm = CustomElement.for<ConcertEditorRoute>(host).viewModel
	await vi.waitFor(() => expect(vm.state).not.toBe('loading'))
	const context = fixture.container.get(IConsoleContext)
	await context.load()
	context.follow({ organizerId: 'org-1', artistId: opts.artist ?? 'a-1' })
	// The router hands the address's parameters to the route before it shows.
	vm.loading({ seriesId: opts.edit?.id ?? '' })
	void vm.attached()
	await vi.waitFor(() => expect(vm.state).toBe('ready'))
	await tasksSettled()
	return {
		fixture,
		host,
		vm,
		list,
		createSeries,
		update,
		setCoverImage,
		search,
		load,
	}
}

type Mounted = Awaited<ReturnType<typeof mount>>

const row = (m: Mounted, index: number) =>
	m.host.querySelector(`[data-row="${index}"]`) as HTMLElement

const venueOf = (r: HTMLElement) =>
	CustomElement.for<VenueField>(r.querySelector('venue-field') as Element)
		.viewModel

/** What a pick does: the field's value becomes the place. */
function pickVenue(r: HTMLElement, place = HANEDA): void {
	venueOf(r).pick(place)
}

/** Chooses a time in a row's time field, as the hour and minute selects do. */
function chooseTime(r: HTMLElement, label: string, time: string): void {
	const field = deepAll(r, 'console-time-field').find(
		(el) => CustomElement.for<ConsoleTimeField>(el).viewModel.label === label,
	)
	if (!field) throw new Error(`no time field ${label}`)
	const [hour, minute] = time.split(':')
	const select = (name: string) =>
		deepOne<HTMLSelectElement>(
			field,
			`select[aria-label="${name}"]`,
		) as HTMLSelectElement
	for (const [name, value] of [
		['時', hour],
		['分', minute],
	]) {
		select(name).value = value
		select(name).dispatchEvent(new Event('change', { bubbles: true }))
	}
}

/** The time a row's time field shows. */
function shownTime(r: HTMLElement, label: string): string {
	const field = deepAll(r, 'console-time-field').find(
		(el) => CustomElement.for<ConsoleTimeField>(el).viewModel.label === label,
	)
	return CustomElement.for<ConsoleTimeField>(field as Element).viewModel.value
}

/** Title, performer and the first date of a new concert, all but the venue. */
function fillNewConcert(m: Mounted, opts: { performer?: boolean } = {}): void {
	fillField(m.host, '公演名', 'XX 冬の単独公演')
	// A new concert starts with the Artist it is created from (Band A) chosen.
	const band = performer(m, 'Band A')
	expect(band.checked).toBe(true)
	if (!(opts.performer ?? true)) {
		band.click()
	}
	fillField(row(m, 0), '日付', '2026-12-01')
}

function performer(m: Mounted, name: string): HTMLInputElement {
	const label = deepAll(m.host, 'fieldset.performers label').find(
		(l) => l.textContent?.trim() === name,
	)
	return label?.querySelector('input') as HTMLInputElement
}

const snacks = (m: Mounted) =>
	deepAll(m.fixture.appHost, '.snack-message').map((el) => deepText(el))

async function save(m: Mounted, name = '保存する'): Promise<void> {
	controlNamed(m.host, name)?.click()
	await tasksSettled()
}

describe('concert editor', () => {
	let restore: () => void
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
		restore = installDialogAndPopover()
	})
	afterEach(() => {
		restore()
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('venue search', () => {
		it(`@spec ${SPEC} "Pick a venue"`, async () => {
			const m = await mount()
			const first = row(m, 0)
			const vf = first.querySelector('venue-field') as HTMLElement
			const combobox = deepOne<HTMLInputElement>(vf, 'input[role="combobox"]')
			if (!combobox) throw new Error('no venue input')
			combobox.value = 'Zepp Haneda'
			combobox.dispatchEvent(new Event('input', { bubbles: true }))
			// The field waits 500 ms after the last keystroke before it searches.
			await vi.waitFor(
				() => expect(deepAll(vf, '[role="option"]')).toHaveLength(1),
				{ timeout: 3000 },
			)
			deepOne(vf, '[role="option"]')?.click()
			await tasksSettled()

			expect(deepText(first)).toContain('Zepp Haneda (TOKYO)')
			expect(deepText(first)).toContain('大田区羽田空港')
			expect(controlNamed(first, '変更')).not.toBeNull()
			expect(m.search).toHaveBeenCalledWith('Zepp Haneda', expect.anything())

			// The picked place is what the new concert's date is saved with.
			fillNewConcert(m)
			await save(m, '公演をつくる')
			expect(m.createSeries).toHaveBeenCalledTimes(1)
			const [draft] = m.createSeries.mock.calls[0] as unknown as [
				{ events: Array<{ placeId?: string; venueName: string }> },
			]
			expect(draft.events[0].placeId).toBe('ChIJ-haneda')
			expect(draft.events[0].venueName).toBe('Zepp Haneda (TOKYO)')
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Typed name not picked"`, async () => {
			const m = await mount()
			fillNewConcert(m)
			const vf = row(m, 0).querySelector('venue-field') as HTMLElement
			const combobox = deepOne<HTMLInputElement>(vf, 'input[role="combobox"]')
			if (!combobox) throw new Error('no venue input')
			combobox.value = 'Zepp Haneda'
			combobox.dispatchEvent(new Event('input', { bubbles: true }))
			await save(m, '公演をつくる')

			expect(deepText(row(m, 0))).toContain('検索結果から会場を選んでください')
			await vi.waitFor(() =>
				expect(deepOne(vf, 'input[role="combobox"]')).toBe(
					(vf.shadowRoot as ShadowRoot).activeElement,
				),
			)
			expect(m.createSeries).not.toHaveBeenCalled()
			await m.fixture.tearDown()
		})
	})

	describe('saving', () => {
		it(`@spec ${SPEC} "Title change only"`, async () => {
			const m = await mount({ edit: XX_SOLO })
			fillField(m.host, '公演名', 'XX 単独公演 2026')
			await save(m)

			expect(m.update).toHaveBeenCalledTimes(1)
			const [id, draft] = m.update.mock.calls[0] as unknown as [
				string,
				{
					title: string
					events: Array<{
						eventId?: string
						placeId?: string
						venueName: string
					}>
				},
			]
			expect(id).toBe('s-solo')
			expect(draft.title).toBe('XX 単独公演 2026')
			expect(draft.events).toHaveLength(1)
			expect(draft.events[0].eventId).toBe('e-1220')
			expect(draft.events[0].placeId).toBe('ChIJ-haneda')
			expect(draft.events[0].venueName).toBe('Zepp Haneda')
			expect(snacks(m)).toContain('変更を保存しました')
			await m.fixture.tearDown()
		})

		it('returns to the concert page from キャンセル without saving', async () => {
			const m = await mount({ edit: XX_SOLO })

			const cancel = controlNamed(m.host, 'キャンセル')
			expect(cancel?.getAttribute('href')).toBe(`${BAND_A_HREF}/s-solo`)
			// Pressing it is a plain link: jsdom cannot follow it, so stop the default.
			cancel?.addEventListener('click', (e) => e.preventDefault())
			cancel?.click()
			await tasksSettled()
			expect(m.update).not.toHaveBeenCalled()
			expect(m.createSeries).not.toHaveBeenCalled()
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "New concert"`, async () => {
			const m = await mount()
			fillNewConcert(m)
			pickVenue(row(m, 0))
			await save(m, '公演をつくる')

			expect(m.createSeries).toHaveBeenCalledTimes(1)
			expect(snacks(m)).toContain('公演をつくりました')
			// The new concert's page opens.
			expect(m.load).toHaveBeenCalledWith(`${BAND_A_HREF}/s-new`)
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Missing performer"`, async () => {
			const m = await mount()
			fillNewConcert(m, { performer: false })
			pickVenue(row(m, 0))
			await save(m, '公演をつくる')

			const group = deepAll(m.host, 'fieldset.performers')[0]
			expect(deepText(group)).toContain('出演者を1組以上選んでください')
			await vi.waitFor(() =>
				expect(document.activeElement).toBe(performer(m, 'Band A')),
			)
			expect(m.createSeries).not.toHaveBeenCalled()
			await m.fixture.tearDown()
		})
	})

	describe('creating from an Artist', () => {
		it(`@spec components/infrastructure/organizer/web/route/concerts "Create from an Artist"`, async () => {
			// Opened under Band B, the second Artist by name: it is first and
			// chosen; Band A is offered, not chosen.
			const m = await mount({ artist: 'a-2' })

			const labels = deepAll(m.host, 'fieldset.performers label').map((l) =>
				l.textContent?.trim(),
			)
			expect(labels).toEqual(['Band B', 'Band A'])
			expect(performer(m, 'Band B').checked).toBe(true)
			expect(performer(m, 'Band A').checked).toBe(false)
			expect(m.host.querySelector('h1')?.textContent?.trim()).toBe('新しい公演')
			await m.fixture.tearDown()
		})
	})

	describe('visibility', () => {
		it(`@spec ${SPEC} "Unlisted concert created"`, async () => {
			const m = await mount()
			const group = deepAll(m.host, 'fieldset.visibility')[0]
			const radio = (label: RegExp) =>
				deepAll<HTMLInputElement>(group, 'label')
					.find((l) => label.test(l.textContent?.trim() ?? ''))
					?.querySelector('input') as HTMLInputElement
			// A new concert starts as 公開, and each choice says what it does.
			expect(radio(/^公開/).checked).toBe(true)
			expect(deepText(group)).toContain('フォロワーへ通知します')
			expect(deepText(group)).toContain(
				'ファン向けの一覧に表示しません。公開してもフォロワーには通知しません。',
			)
			// No share link is promised: UNLISTED concerts have no fan entry yet (D21).
			expect(deepText(group)).not.toContain('共有リンク')

			fillNewConcert(m)
			pickVenue(row(m, 0))
			radio(/^限定公開/).click()
			await save(m, '公演をつくる')

			expect(m.createSeries).toHaveBeenCalledTimes(1)
			const [draft] = m.createSeries.mock.calls[0] as unknown as [
				{ visibility: Visibility },
			]
			expect(draft.visibility).toBe(Visibility.UNLISTED)
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Visibility fixed after publish"`, async () => {
			const m = await mount({ edit: TOUR })

			const group = deepAll(
				m.host,
				'fieldset.visibility',
			)[0] as HTMLFieldSetElement
			const radios = deepAll<HTMLInputElement>(group, 'input[type="radio"]')
			const labelOf = (r: HTMLInputElement) =>
				r.closest('label')?.textContent?.trim() ?? ''
			expect(radios.find((r) => /^公開/.test(labelOf(r)))?.checked).toBe(true)
			// The fieldset is disabled, so both radios are.
			expect(group.disabled).toBe(true)
			expect(radios.every((r) => r.matches(':disabled'))).toBe(true)
			expect(deepText(group)).toContain('公開範囲は変更できません')
			await m.fixture.tearDown()
		})
	})

	describe('a published concert', () => {
		it(`@spec ${SPEC} "Published event's venue is fixed"`, async () => {
			const m = await mount({ edit: TOUR })

			const first = row(m, 0)
			expect(deepText(first)).toContain('公開中')
			expect(deepText(first)).toContain(
				'公開済みのため、会場と日付は変更できません',
			)
			expect(deepText(first)).toContain('Zepp Haneda')
			expect(first.querySelector('venue-field')).toBeNull()
			expect(controlNamed(first, '変更')).toBeNull()
			const date = fieldNamed(first, '日付')
			expect(date?.readonly).toBe(true)
			expect(date?.input.readOnly).toBe(true)
			expect(controlNamed(m.host, 'この公演日を削除')).toBeNull()
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Additional date saved as a draft"`, async () => {
			const m = await mount({ edit: TOUR })
			controlNamed(m.host, '公演日を追加')?.click()
			await tasksSettled()

			const added = row(m, 4)
			expect(deepText(added)).toContain('下書き')
			// The new date starts as a copy of the last one (Zepp Fukuoka).
			expect(deepText(added)).toContain('Zepp Fukuoka')
			controlNamed(added, '変更')?.click()
			await tasksSettled()
			pickVenue(added)
			fillField(added, '日付', '2026-12-01')
			chooseTime(added, '開演', '18:00')
			await save(m)

			expect(m.update).toHaveBeenCalledTimes(1)
			const [, draft] = m.update.mock.calls[0] as unknown as [
				string,
				{
					events: Array<{ eventId?: string; placeId?: string }>
				},
			]
			expect(draft.events).toHaveLength(5)
			expect(draft.events[4].eventId).toBeUndefined()
			expect(draft.events[4].placeId).toBe('ChIJ-haneda')
			expect(snacks(m)).toContain('変更を保存しました')
			expect(m.load).toHaveBeenCalledWith(`${BAND_A_HREF}/s-tour`)
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Start time already on sale"`, async () => {
			const update = vi
				.fn()
				.mockRejectedValue(
					new ConnectError('tickets on sale', Code.FailedPrecondition),
				)
			const m = await mount({ edit: TOUR, update })
			chooseTime(row(m, 0), '開演', '19:00')
			await save(m)

			expect(snacks(m).join('')).toContain(
				'チケットの販売が始まった公演日の開始時刻は変更できないため、保存していません。',
			)
			expect(deepAll(m.fixture.appHost, '.snack-action-btn')).toHaveLength(0)
			expect(update).toHaveBeenCalledTimes(1)
			// Nothing was saved: the change is still unsaved in the editor.
			expect(shownTime(row(m, 0), '開演')).toBe('19:00')
			expect(m.vm.isDirty).toBe(true)
			await m.fixture.tearDown()
		})
	})

	describe("each date's per-account limit", () => {
		const limit = (r: HTMLElement) => fieldNamed(r, /1アカウントの上限/)

		it(`@spec ${SPEC} "Above one admission code"`, async () => {
			const m = await mount({ edit: XX_SOLO })
			fillField(row(m, 0), /1アカウントの上限/, '11')
			await save(m)

			const box = row(m, 0).querySelector('[data-field="limit"]') as HTMLElement
			expect(deepText(box)).toContain(
				'1アカウントの上限は1〜10枚の整数で入力してください',
			)
			expect(limit(row(m, 0))?.input.getAttribute('aria-invalid')).toBe('true')
			expect(m.update).not.toHaveBeenCalled()
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Published date"`, async () => {
			const sixPerAccount: ConcertSpec = {
				...TOUR,
				events: TOUR.events.map((e) => ({ ...e, perAccountLimit: 6 })),
			}
			const m = await mount({
				edit: sixPerAccount,
				list: vi.fn(async () => [authored(sixPerAccount)]),
			})

			const first = row(m, 0)
			expect(limit(first)?.input.value).toBe('6')
			expect(limit(first)?.input.readOnly).toBe(true)
			expect(
				deepText(first.querySelector('[data-field="limit"]') as Element),
			).toContain('公演日を公開すると変えられません。')
			fillField(m.host, '公演名', 'XX Tour 2026 追加公演あり')
			await save(m)

			// Saving sends the limit back as it was, so it stays.
			const [, draft] = m.update.mock.calls[0] as unknown as [
				string,
				{ events: Array<{ perAccountLimit?: number }> },
			]
			expect(draft.events.map((e) => e.perAccountLimit)).toEqual([6, 6, 6, 6])
			expect(snacks(m)).toContain('変更を保存しました')
			await m.fixture.tearDown()
		})
	})

	describe('cover image', () => {
		const PROCESSING =
			'選んだ画像を表示しています。最適化した画像の準備ができると切り替わります。'
		const NEW_COVER =
			'https://cdn.liverty-music.app/series-images/img-new/large.webp'

		/** The upload steps answered: a signed URL for the new image `img-new`. */
		function uploads() {
			return {
				createUploadUrl: vi.fn(async () => ({
					uploadUrl: 'https://storage.example/series-images/img-new',
					seriesImageId: 'img-new',
					maxBytes: 10_485_760,
				})),
				uploadToSignedUrl: vi.fn(async () => undefined),
			}
		}

		/** Picks a PNG in the cover input, as the file chooser does. */
		async function pickCover(m: Mounted): Promise<void> {
			const input = m.host.querySelector(
				'input[type="file"]',
			) as HTMLInputElement
			const file = new File([new Uint8Array([137, 80, 78, 71])], 'cover.png', {
				type: 'image/png',
			})
			Object.defineProperty(input, 'files', {
				configurable: true,
				value: [file],
			})
			input.dispatchEvent(new Event('change', { bubbles: true }))
			await tasksSettled()
		}

		const preview = (m: Mounted) =>
			m.host.querySelector('[data-testid="cover-preview"]') as HTMLImageElement
		const note = (m: Mounted) =>
			deepAll(m.host, '.note[role="status"]').map((el) => deepText(el))

		const objectUrls = {
			create: URL.createObjectURL,
			revoke: URL.revokeObjectURL,
		}
		beforeEach(() => {
			// jsdom has no object URLs: the picked file's preview is a blob URL.
			URL.createObjectURL = vi.fn(() => 'blob:http://localhost/picked-cover')
			URL.revokeObjectURL = vi.fn()
		})
		afterEach(() => {
			URL.createObjectURL = objectUrls.create
			URL.revokeObjectURL = objectUrls.revoke
		})

		it(`@spec ${SPEC} "Image just uploaded"`, async () => {
			const seriesImages = uploads()
			const m = await mount({ edit: XX_SOLO, seriesImages })
			await pickCover(m)

			await vi.waitFor(() =>
				expect(preview(m)?.getAttribute('src')).toMatch(/^blob:/),
			)
			expect(note(m)).toEqual([PROCESSING])
			expect(seriesImages.createUploadUrl).toHaveBeenCalledWith(
				'image/png',
				expect.anything(),
			)
			expect(seriesImages.uploadToSignedUrl).toHaveBeenCalledTimes(1)
			expect(m.setCoverImage).toHaveBeenCalledWith(
				's-solo',
				'img-new',
				expect.anything(),
			)
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Processed image available"`, async () => {
			// The editor's 3 s re-read runs on a fake clock, advanced below.
			let coverSet = false
			let listsAfterSet = 0
			const list = vi.fn(async () => {
				if (coverSet) listsAfterSet++
				const concert = authored(XX_SOLO)
				// The first check after the cover is set still sees no processed
				// image; the next one sees it.
				if (listsAfterSet >= 2) {
					concert.series.coverImage = {
						id: { value: 'img-new' },
						large: { value: NEW_COVER },
						thumb: { value: NEW_COVER },
					} as never
				}
				return [concert]
			})
			const setCoverImage = vi.fn(async () => {
				coverSet = true
			})
			const m = await mount({
				edit: XX_SOLO,
				seriesImages: uploads(),
				list,
				setCoverImage,
			})
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
			await pickCover(m)
			await vi.waitFor(() =>
				expect(preview(m)?.getAttribute('src')).toMatch(/^blob:/),
			)
			expect(note(m)).toEqual([PROCESSING])

			// The editor re-reads the concert every 3 s until the cover is processed.
			await vi.advanceTimersByTimeAsync(3000)
			expect(preview(m).getAttribute('src')).toMatch(/^blob:/)
			await vi.advanceTimersByTimeAsync(3000)
			await tasksSettled()

			expect(preview(m).getAttribute('src')).toBe(NEW_COVER)
			expect(note(m)).toEqual([])
			expect(listsAfterSet).toBe(2)
			await m.fixture.tearDown()
		})
	})
})
