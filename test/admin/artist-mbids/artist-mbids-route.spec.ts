import { createFixture } from '@aurelia/testing'
import {
	type Artist,
	ArtistSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import {
	type CatalogArtist,
	CatalogArtistSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/catalog_artist_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Replace the real client modules (which would build a Connect transport)
// with fresh interface tokens so the fixture binds to the test doubles.
const IArtistClient = DI.createInterface('IArtistClient')
const ICatalogArtistClient = DI.createInterface('ICatalogArtistClient')
vi.mock('../../../admin/services/artist-client', () => ({ IArtistClient }))
vi.mock('../../../admin/services/catalog-artist-client', () => ({
	ICatalogArtistClient,
}))

const { ArtistMbidsRoute } = await import(
	'../../../admin/artist-mbids/artist-mbids-route'
)

const ROUTE_SPEC = 'components/infrastructure/admin/web/route/artist-mbids'

const PENTHOUSE_ID = '019e302a-3ea8-7a7b-ad8d-b9c02a2ef15d'
const UK_BAND = 'c94eaf81-baae-465d-8197-9951c2ef52cd'
const JP_BAND = '9604bb00-65c5-4b67-a174-c46c063ba794'

function artist(id: string, name: string, mbid: string): Artist {
	return create(ArtistSchema, {
		id: { value: id },
		name: { value: name },
		mbid: { value: mbid },
	})
}

interface CandidateInit {
	mbid: string
	name?: string
	country?: string
	begin?: { year: number; month?: number; day?: number }
	end?: { year: number; month?: number; day?: number }
	activityEnded?: boolean
	disambiguation?: string
	site?: string
}

function candidate(init: CandidateInit): CatalogArtist {
	const date = (d?: { year: number; month?: number; day?: number }) =>
		d
			? { value: { year: d.year, month: d.month ?? 0, day: d.day ?? 0 } }
			: undefined
	return create(CatalogArtistSchema, {
		mbid: { value: init.mbid },
		name: { value: init.name ?? 'Penthouse' },
		country: init.country ? { value: init.country } : undefined,
		begin: date(init.begin),
		end: date(init.end),
		activityEnded: init.activityEnded ?? false,
		disambiguation: init.disambiguation
			? { value: init.disambiguation }
			: undefined,
		officialSiteUrl: init.site ? { value: init.site } : undefined,
	})
}

const ukBand = candidate({
	mbid: UK_BAND,
	country: 'GB',
	begin: { year: 1995, month: 10 },
	end: { year: 2002, month: 11 },
	activityEnded: true,
	disambiguation: 'UK indie rock band',
})
const jpBand = candidate({
	mbid: JP_BAND,
	begin: { year: 2018 },
	disambiguation: 'Japanese city soul band',
	site: 'https://penthouse.example/',
})

interface Clients {
	artist: {
		listAmbiguous: ReturnType<typeof vi.fn>
		correctMbid: ReturnType<typeof vi.fn>
	}
	catalog: { listByArtist: ReturnType<typeof vi.fn> }
}

function clients(
	artists: Artist[] = [artist(PENTHOUSE_ID, 'Penthouse', UK_BAND)],
	namesakes: CatalogArtist[] = [ukBand, jpBand],
): Clients {
	return {
		artist: {
			listAmbiguous: vi.fn().mockResolvedValue(artists),
			correctMbid: vi
				.fn()
				.mockResolvedValue(artist(PENTHOUSE_ID, 'Penthouse', JP_BAND)),
		},
		catalog: { listByArtist: vi.fn().mockResolvedValue(namesakes) },
	}
}

async function build(c: Clients) {
	const fixture = createFixture
		.html('<artist-mbids-route component.ref="route"></artist-mbids-route>')
		.deps(
			ArtistMbidsRoute,
			Registration.instance(IArtistClient, c.artist),
			Registration.instance(ICatalogArtistClient, c.catalog),
		)
		.build()
	await fixture.started
	const route = routeOf(fixture)
	await route.loading()
	await fixture.tasksSettled
	return fixture
}

type Fixture = Awaited<ReturnType<typeof build>>

function routeOf(fixture: {
	component: unknown
}): InstanceType<typeof ArtistMbidsRoute> {
	return (fixture.component as { route: InstanceType<typeof ArtistMbidsRoute> })
		.route
}

const all = <T extends Element>(fixture: Fixture, testId: string) => [
	...fixture.appHost.querySelectorAll<T>(`[data-testid="${testId}"]`),
]
const q = <T extends Element>(fixture: Fixture, testId: string) =>
	fixture.appHost.querySelector<T>(`[data-testid="${testId}"]`)
const text = (el: Element | null | undefined) =>
	el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

async function selectFirst(fixture: Fixture) {
	q<HTMLButtonElement>(fixture, 'artist-mbids-artist')?.click()
	await vi.waitFor(() =>
		expect(routeOf(fixture).namesakePhase).not.toBe('loading'),
	)
	await fixture.tasksSettled
}

function candidateCards(fixture: Fixture) {
	return all<HTMLElement>(fixture, 'artist-mbids-candidate')
}

function dialogOf(fixture: Fixture): HTMLDialogElement {
	const dialog = q<HTMLDialogElement>(fixture, 'artist-mbids-dialog')
	if (!dialog) throw new Error('dialog not rendered')
	return dialog
}

function dialogButton(fixture: Fixture, label: string): HTMLButtonElement {
	const button = [
		...dialogOf(fixture).querySelectorAll<HTMLButtonElement>('button'),
	].find((b) => b.textContent?.trim() === label)
	if (!button) throw new Error(`dialog button ${label} not rendered`)
	return button
}

async function confirm(fixture: Fixture) {
	dialogButton(fixture, 'Set MBID').click()
	await vi.waitFor(() => expect(routeOf(fixture).saving).toBe(false))
	await fixture.tasksSettled
}

async function enterMbid(fixture: Fixture, value: string) {
	const input = q<HTMLInputElement>(fixture, 'artist-mbids-mbid-input')
	if (!input) throw new Error('MBID field not rendered')
	input.value = value
	input.dispatchEvent(new Event('input'))
	q<HTMLButtonElement>(fixture, 'artist-mbids-set')?.click()
	await fixture.tasksSettled
}

describe('ArtistMbidsRoute', () => {
	// jsdom implements neither showModal nor close; model them so the dialog's
	// open state and its close event (Escape included) can be asserted.
	const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>
	const original = { showModal: proto.showModal, close: proto.close }

	beforeEach(() => {
		vi.clearAllMocks()
		proto.showModal = function (this: HTMLDialogElement) {
			this.setAttribute('open', '')
		}
		proto.close = function (this: HTMLDialogElement) {
			if (!this.hasAttribute('open')) return
			this.removeAttribute('open')
			this.dispatchEvent(new Event('close'))
		}
	})

	afterEach(() => {
		proto.showModal = original.showModal
		proto.close = original.close
	})

	it(`@spec ${ROUTE_SPEC} "Two ambiguous artists"`, async () => {
		const fixture = await build(
			clients([
				artist(PENTHOUSE_ID, 'Penthouse', UK_BAND),
				artist('019e3029-f15b-77ce-ab29-4fe2cb0d6a5f', 'Yama', JP_BAND),
			]),
		)

		const rows = all(fixture, 'artist-mbids-artist').map(text)
		expect(rows).toEqual([`Penthouse ${UK_BAND}`, `Yama ${JP_BAND}`])
	})

	it(`@spec ${ROUTE_SPEC} "Nothing to choose"`, async () => {
		const fixture = await build(clients([]))

		expect(text(q(fixture, 'artist-mbids-empty'))).toBe(
			'No artist is waiting for an MBID choice.',
		)
	})

	it(`@spec ${ROUTE_SPEC} "Namesakes shown"`, async () => {
		const c = clients()
		const fixture = await build(c)
		await selectFirst(fixture)

		expect(c.catalog.listByArtist).toHaveBeenCalledWith(
			PENTHOUSE_ID,
			expect.anything(),
		)
		const [uk, jp] = candidateCards(fixture)
		expect(text(uk)).toContain('Current')
		expect(
			text(uk.querySelector('[data-testid="artist-mbids-life-span"]')),
		).toBe('1995-10 to 2002-11')
		expect(text(uk)).toContain('GB')
		expect(text(uk)).toContain('UK indie rock band')
		expect(uk.querySelector('[data-testid="artist-mbids-site"]')).toBeNull()
		const mbidLink = uk.querySelector<HTMLAnchorElement>(
			'[data-testid="artist-mbids-candidate-mbid"]',
		)
		expect(mbidLink?.href).toBe(`https://musicbrainz.org/artist/${UK_BAND}`)
		expect(mbidLink?.target).toBe('_blank')
		expect(jp.querySelector('[data-testid="artist-mbids-current"]')).toBeNull()
		expect(
			jp.querySelector<HTMLAnchorElement>('[data-testid="artist-mbids-site"]')
				?.href,
		).toBe('https://penthouse.example/')
	})

	it(`@spec ${ROUTE_SPEC} "Namesake ended without an end date"`, async () => {
		const fixture = await build(
			clients(undefined, [
				candidate({ mbid: UK_BAND }),
				candidate({
					mbid: JP_BAND,
					begin: { year: 1998 },
					activityEnded: true,
				}),
			]),
		)
		await selectFirst(fixture)

		expect(
			text(
				candidateCards(fixture)[1].querySelector(
					'[data-testid="artist-mbids-life-span"]',
				),
			),
		).toBe('1998 ended')
	})

	it(`@spec ${ROUTE_SPEC} "Current MBID listed without a life span"`, async () => {
		const fixture = await build(
			clients(undefined, [
				candidate({ mbid: UK_BAND, activityEnded: true }),
				jpBand,
			]),
		)
		await selectFirst(fixture)

		const current = candidateCards(fixture)[0]
		expect(text(current)).toContain('Current')
		expect(
			text(current.querySelector('[data-testid="artist-mbids-life-span"]')),
		).toBe('ended')
	})

	it(`@spec ${ROUTE_SPEC} "Namesake with an end and no begin"`, async () => {
		const fixture = await build(
			clients(undefined, [
				candidate({ mbid: UK_BAND, end: { year: 2002 }, activityEnded: true }),
			]),
		)
		await selectFirst(fixture)

		expect(
			text(
				candidateCards(fixture)[0].querySelector(
					'[data-testid="artist-mbids-life-span"]',
				),
			),
		).toBe('to 2002')
	})

	it(`@spec ${ROUTE_SPEC} "Catalog unreachable"`, async () => {
		const c = clients()
		c.catalog.listByArtist.mockRejectedValueOnce(
			new ConnectError('musicbrainz down', Code.Unavailable),
		)
		const fixture = await build(c)
		await selectFirst(fixture)

		const error = q(fixture, 'artist-mbids-namesake-error')
		expect(text(error)).toContain(
			'The music catalog could not be reached. Try again.',
		)
		const retry = error?.querySelector('button')
		expect(text(retry)).toBe('Try again')

		retry?.click()
		await vi.waitFor(() => expect(routeOf(fixture).namesakePhase).toBe('ready'))
		expect(c.catalog.listByArtist).toHaveBeenCalledTimes(2)
	})

	it(`@spec ${ROUTE_SPEC} "Namesake chosen"`, async () => {
		const c = clients()
		const fixture = await build(c)
		await selectFirst(fixture)

		candidateCards(fixture)[1]
			.querySelector<HTMLButtonElement>('[data-testid="artist-mbids-choose"]')
			?.click()
		await fixture.tasksSettled
		expect(dialogOf(fixture).hasAttribute('open')).toBe(true)
		expect(text(dialogOf(fixture))).toContain('Penthouse')
		expect(document.activeElement).toBe(dialogButton(fixture, 'Cancel'))
		await confirm(fixture)

		expect(c.artist.correctMbid).toHaveBeenCalledWith(PENTHOUSE_ID, JP_BAND)
		expect(all(fixture, 'artist-mbids-artist')).toHaveLength(0)
		expect(text(q(fixture, 'artist-mbids-verified'))).toBe(
			'Penthouse is verified.',
		)
	})

	it(`@spec ${ROUTE_SPEC} "Current MBID chosen"`, async () => {
		const c = clients()
		const fixture = await build(c)
		await selectFirst(fixture)

		candidateCards(fixture)[0]
			.querySelector<HTMLButtonElement>('[data-testid="artist-mbids-choose"]')
			?.click()
		await fixture.tasksSettled
		await confirm(fixture)

		expect(c.artist.correctMbid).toHaveBeenCalledWith(PENTHOUSE_ID, UK_BAND)
		expect(all(fixture, 'artist-mbids-artist')).toHaveLength(0)
	})

	it(`@spec ${ROUTE_SPEC} "Cancelled"`, async () => {
		const c = clients()
		const fixture = await build(c)
		await selectFirst(fixture)

		candidateCards(fixture)[1]
			.querySelector<HTMLButtonElement>('[data-testid="artist-mbids-choose"]')
			?.click()
		await fixture.tasksSettled
		// Escape on a modal dialog closes it, firing its close event.
		dialogOf(fixture).close()
		await fixture.tasksSettled

		expect(dialogOf(fixture).hasAttribute('open')).toBe(false)
		expect(routeOf(fixture).pending).toBeNull()
		expect(c.artist.correctMbid).not.toHaveBeenCalled()
	})

	it(`@spec ${ROUTE_SPEC} "MBID already held"`, async () => {
		const c = clients()
		c.artist.correctMbid.mockRejectedValueOnce(
			new ConnectError('taken', Code.AlreadyExists),
		)
		const fixture = await build(c)
		await selectFirst(fixture)

		candidateCards(fixture)[1]
			.querySelector<HTMLButtonElement>('[data-testid="artist-mbids-choose"]')
			?.click()
		await fixture.tasksSettled
		await confirm(fixture)

		expect(text(q(fixture, 'artist-mbids-choice-error'))).toBe(
			'Another artist already has this MBID.',
		)
		expect(all(fixture, 'artist-mbids-artist')).toHaveLength(1)
	})

	it(`@spec ${ROUTE_SPEC} "MBID entered for an artist without namesakes"`, async () => {
		const entered = '0b4f5e6a-7c8d-4e9f-a0b1-c2d3e4f5a6b7'
		const c = clients(undefined, [])
		c.artist.correctMbid.mockResolvedValueOnce(
			artist(PENTHOUSE_ID, 'PENTHOUSE', entered),
		)
		const fixture = await build(c)
		await selectFirst(fixture)

		await enterMbid(fixture, entered)
		expect(dialogOf(fixture).hasAttribute('open')).toBe(true)
		expect(text(dialogOf(fixture))).toContain(entered)
		await confirm(fixture)

		expect(c.artist.correctMbid).toHaveBeenCalledWith(PENTHOUSE_ID, entered)
		expect(all(fixture, 'artist-mbids-artist')).toHaveLength(0)
		expect(text(q(fixture, 'artist-mbids-verified'))).toBe(
			'PENTHOUSE is verified.',
		)
	})

	it(`@spec ${ROUTE_SPEC} "Malformed MBID entered"`, async () => {
		const c = clients()
		const fixture = await build(c)
		await selectFirst(fixture)

		await enterMbid(fixture, 'abc')

		expect(fixture.appHost.textContent).toContain(
			'Enter an MBID of 36 characters.',
		)
		expect(dialogOf(fixture).hasAttribute('open')).toBe(false)

		// 36 characters that are not a UUID are refused as well.
		await enterMbid(fixture, 'https://musicbrainz.org/artist/9604b')
		expect(routeOf(fixture).mbidError).toBe('Enter an MBID of 36 characters.')
		expect(dialogOf(fixture).hasAttribute('open')).toBe(false)
		expect(c.artist.correctMbid).not.toHaveBeenCalled()
	})

	it(`@spec ${ROUTE_SPEC} "MBID unknown to the catalog"`, async () => {
		const c = clients()
		c.artist.correctMbid.mockRejectedValueOnce(
			new ConnectError('no such artist', Code.NotFound),
		)
		const fixture = await build(c)
		await selectFirst(fixture)

		await enterMbid(fixture, '0b4f5e6a-7c8d-4e9f-a0b1-c2d3e4f5a6b7')
		await confirm(fixture)

		expect(text(q(fixture, 'artist-mbids-choice-error'))).toBe(
			'The music catalog has no artist with this MBID.',
		)
		expect(all(fixture, 'artist-mbids-artist')).toHaveLength(1)
	})

	it('shows any other failure with copy the console owns', async () => {
		const c = clients()
		c.artist.correctMbid.mockRejectedValueOnce(
			new ConnectError('db: connection reset', Code.Internal),
		)
		const fixture = await build(c)
		await selectFirst(fixture)
		candidateCards(fixture)[1]
			.querySelector<HTMLButtonElement>('[data-testid="artist-mbids-choose"]')
			?.click()
		await fixture.tasksSettled
		await confirm(fixture)

		expect(text(q(fixture, 'artist-mbids-choice-error'))).toBe(
			'The MBID could not be set. Try again.',
		)
		expect(fixture.appHost.textContent).not.toContain('connection reset')
	})
})
