import { createFixture } from '@aurelia/testing'
import {
	Artist,
	ArtistId,
	ArtistName,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import {
	Organizer,
	OrganizerId,
	OrganizerName,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The route resolves IOrganizerClient + IArtistSearchClient. Replace the real
// modules (which would build Connect transports over the generated clients) with
// fresh interface tokens so the fixture binds to the test doubles.
const IOrganizerClient = DI.createInterface('IOrganizerClient')
const IArtistSearchClient = DI.createInterface('IArtistSearchClient')

vi.mock('../../../admin/services/organizer-client', () => ({
	IOrganizerClient,
}))
vi.mock('../../../admin/services/artist-search-client', () => ({
	IArtistSearchClient,
}))

const { OrganizersRoute } = await import(
	'../../../admin/organizers/organizers-route'
)

interface MockOrganizerClient {
	create: ReturnType<typeof vi.fn>
	list: ReturnType<typeof vi.fn>
	get: ReturnType<typeof vi.fn>
	listArtists: ReturnType<typeof vi.fn>
	associateArtist: ReturnType<typeof vi.fn>
	disassociateArtist: ReturnType<typeof vi.fn>
	deactivate: ReturnType<typeof vi.fn>
}

interface MockSearchClient {
	search: ReturnType<typeof vi.fn>
}

function makeOrganizer(id: string, name: string): Organizer {
	return new Organizer({
		id: new OrganizerId({ value: id }),
		name: new OrganizerName({ value: name }),
	})
}

function makeArtist(id: string, name: string): Artist {
	return new Artist({
		id: new ArtistId({ value: id }),
		name: new ArtistName({ value: name }),
	})
}

function createMockOrganizerClient(
	overrides: Partial<MockOrganizerClient> = {},
): MockOrganizerClient {
	return {
		create: vi.fn().mockResolvedValue(makeOrganizer('o-new', 'New Org')),
		list: vi.fn().mockResolvedValue([]),
		get: vi.fn().mockResolvedValue(makeOrganizer('o1', 'Org One')),
		listArtists: vi.fn().mockResolvedValue([]),
		associateArtist: vi.fn().mockResolvedValue(undefined),
		disassociateArtist: vi.fn().mockResolvedValue(undefined),
		deactivate: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

function createMockSearchClient(
	overrides: Partial<MockSearchClient> = {},
): MockSearchClient {
	return {
		search: vi.fn().mockResolvedValue([]),
		...overrides,
	}
}

async function build(
	client: MockOrganizerClient,
	searchClient: MockSearchClient,
) {
	const fixture = createFixture
		.html('<organizers-route component.ref="route"></organizers-route>')
		.deps(
			OrganizersRoute,
			Registration.instance(IOrganizerClient, client),
			Registration.instance(IArtistSearchClient, searchClient),
		)
		.build()
	await fixture.started
	return fixture
}

function routeOf(
	fixture: Awaited<ReturnType<typeof build>>,
): InstanceType<typeof OrganizersRoute> {
	return (fixture.component as { route: InstanceType<typeof OrganizersRoute> })
		.route
}

describe('OrganizersRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useRealTimers()
	})

	describe('list', () => {
		it('loads and flattens organizers on attach', async () => {
			const client = createMockOrganizerClient({
				list: vi
					.fn()
					.mockResolvedValue([
						makeOrganizer('o1', 'Org One'),
						makeOrganizer('o2', 'Org Two'),
					]),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			expect(vm.phase).toBe('ready')
			expect(vm.organizers).toHaveLength(2)
			expect(vm.organizers[0].name).toBe('Org One')
			expect(fixture.appHost.textContent).toContain('Org One')
			expect(fixture.appHost.textContent).toContain('Org Two')
		})

		it('renders the empty state when there are no organizers', async () => {
			const fixture = await build(
				createMockOrganizerClient(),
				createMockSearchClient(),
			)
			expect(routeOf(fixture).isEmpty).toBe(true)
			expect(fixture.appHost.textContent).toContain('No organizers yet')
		})

		it('surfaces the error state when the list fails', async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockRejectedValue(new Error('boom')),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			expect(vm.phase).toBe('error')
			expect(vm.loadError).toContain('boom')
			expect(fixture.appHost.textContent).toContain('Could not load organizers')
		})
	})

	describe('create', () => {
		it('requires a name and operator email', async () => {
			const client = createMockOrganizerClient()
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			vm.newName = '  '
			vm.newOperatorEmail = ''
			await vm.createOrganizer()

			expect(client.create).not.toHaveBeenCalled()
			expect(vm.createError).toContain('required')
		})

		it('creates, clears the form, appends the row, and selects it', async () => {
			const created = makeOrganizer('o-new', 'New Org')
			const client = createMockOrganizerClient({
				create: vi.fn().mockResolvedValue(created),
				listArtists: vi.fn().mockResolvedValue([]),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			vm.newName = 'New Org'
			vm.newOperatorEmail = 'owner@example.com'
			await vm.createOrganizer()

			expect(client.create).toHaveBeenCalledWith('New Org', 'owner@example.com')
			expect(vm.newName).toBe('')
			expect(vm.newOperatorEmail).toBe('')
			expect(vm.organizers.map((o) => o.id)).toContain('o-new')
			// Freshly created organizer becomes the selection + its roster loads.
			expect(vm.selected?.id).toBe('o-new')
			expect(client.listArtists).toHaveBeenCalledWith('o-new')
		})

		it('maps INVALID_ARGUMENT to a user-facing create error', async () => {
			const client = createMockOrganizerClient({
				create: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('name too long', Code.InvalidArgument),
					),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			vm.newName = 'x'
			vm.newOperatorEmail = 'a@b.co'
			await vm.createOrganizer()

			expect(vm.createError).toContain('name too long')
			expect(vm.creating).toBe(false)
		})
	})

	describe('select + roster', () => {
		it('loads the roster for the selected organizer', async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
				listArtists: vi
					.fn()
					.mockResolvedValue([makeArtist('a1', 'Artist One')]),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			await vm.select(vm.organizers[0])

			expect(vm.isSelected(vm.organizers[0])).toBe(true)
			expect(vm.artists).toHaveLength(1)
			expect(vm.artists[0].name).toBe('Artist One')
			expect(fixture.appHost.textContent).toContain('Artist One')
		})

		it('shows a roster error when listArtists fails', async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
				listArtists: vi.fn().mockRejectedValue(new Error('roster boom')),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			await vm.select(vm.organizers[0])

			expect(vm.detailPhase).toBe('error')
			expect(vm.detailError).toContain('roster boom')
		})
	})

	describe('deactivate', () => {
		it('calls deactivate and refreshes the roster', async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)
			await vm.select(vm.organizers[0])

			await vm.deactivate()

			expect(client.deactivate).toHaveBeenCalledWith('o1')
			expect(client.listArtists).toHaveBeenCalledTimes(2)
		})

		it('maps FAILED_PRECONDITION to a deactivated message', async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
				deactivate: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('already off', Code.FailedPrecondition),
					),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)
			await vm.select(vm.organizers[0])

			await vm.deactivate()

			expect(vm.deactivateError).toContain('deactivated')
		})
	})

	describe('disassociate', () => {
		it('removes the artist from the roster on success', async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
				listArtists: vi
					.fn()
					.mockResolvedValue([
						makeArtist('a1', 'Artist One'),
						makeArtist('a2', 'Artist Two'),
					]),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)
			await vm.select(vm.organizers[0])

			await vm.disassociate(vm.artists[0])

			expect(client.disassociateArtist).toHaveBeenCalledWith('o1', 'a1')
			expect(vm.artists.map((a) => a.id)).toEqual(['a2'])
		})

		it('surfaces an error and keeps the artist when disassociate fails', async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
				listArtists: vi
					.fn()
					.mockResolvedValue([makeArtist('a1', 'Artist One')]),
				disassociateArtist: vi.fn().mockRejectedValue(new Error('remove boom')),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)
			await vm.select(vm.organizers[0])

			await vm.disassociate(vm.artists[0])

			expect(vm.associateError).toContain('remove boom')
			expect(vm.artists).toHaveLength(1)
		})
	})

	describe('search + associate', () => {
		it('does not search for a query shorter than the minimum', async () => {
			const searchClient = createMockSearchClient()
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
			})
			const fixture = await build(client, searchClient)
			const vm = routeOf(fixture)
			await vm.select(vm.organizers[0])

			vm.searchQuery = 'a'
			vm.onSearchInput()

			expect(searchClient.search).not.toHaveBeenCalled()
			expect(vm.searchResults).toHaveLength(0)
		})

		it('debounces then runs the search and stores results', async () => {
			vi.useFakeTimers()
			const searchClient = createMockSearchClient({
				search: vi.fn().mockResolvedValue([makeArtist('a9', 'Found Act')]),
			})
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
			})
			const fixture = await build(client, searchClient)
			const vm = routeOf(fixture)
			await vm.select(vm.organizers[0])

			vm.searchQuery = 'found'
			vm.onSearchInput()
			expect(searchClient.search).not.toHaveBeenCalled()

			await vi.advanceTimersByTimeAsync(300)

			expect(searchClient.search).toHaveBeenCalledWith(
				'found',
				expect.any(AbortSignal),
			)
			expect(vm.searchResults.map((a) => a.name)).toEqual(['Found Act'])
		})

		it('associates a searched artist, adds it to the roster, and drops it from results', async () => {
			const searchClient = createMockSearchClient()
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
			})
			const fixture = await build(client, searchClient)
			const vm = routeOf(fixture)
			await vm.select(vm.organizers[0])

			// Seed a result directly (bypass the debounced input path).
			const result = { id: 'a9', name: 'Found Act' }
			vm.searchResults = [result]

			await vm.associate(result)

			expect(client.associateArtist).toHaveBeenCalledWith('o1', 'a9')
			expect(vm.artists.map((a) => a.id)).toContain('a9')
			expect(vm.searchResults).toHaveLength(0)
		})

		it('maps ALREADY_EXISTS on a double-claim associate', async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
				associateArtist: vi
					.fn()
					.mockRejectedValue(new ConnectError('claimed', Code.AlreadyExists)),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)
			await vm.select(vm.organizers[0])

			await vm.associate({ id: 'a9', name: 'Found Act' })

			expect(vm.associateError).toContain('already represented')
			expect(vm.associatingId).toBe('')
		})

		it('surfaces a search error when the search RPC fails', async () => {
			vi.useFakeTimers()
			const searchClient = createMockSearchClient({
				search: vi.fn().mockRejectedValue(new Error('search boom')),
			})
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
			})
			const fixture = await build(client, searchClient)
			const vm = routeOf(fixture)
			await vm.select(vm.organizers[0])

			vm.searchQuery = 'zzz'
			vm.onSearchInput()
			await vi.advanceTimersByTimeAsync(300)

			expect(vm.searchError).toContain('search boom')
			expect(vm.searching).toBe(false)
		})
	})
})
