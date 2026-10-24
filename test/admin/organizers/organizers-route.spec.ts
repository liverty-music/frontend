import { createFixture } from '@aurelia/testing'
import {
	type Artist,
	ArtistSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import {
	type Organizer,
	OrganizerSchema,
	OrganizerStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The route resolves IOrganizerClient + IArtistClient. Replace the real
// modules (which would build Connect transports over the generated clients) with
// fresh interface tokens so the fixture binds to the test doubles.
const IOrganizerClient = DI.createInterface('IOrganizerClient')
const IArtistClient = DI.createInterface('IArtistClient')

vi.mock('../../../admin/services/organizer-client', () => ({
	IOrganizerClient,
}))
vi.mock('../../../admin/services/artist-client', () => ({
	IArtistClient,
}))

const { OrganizersRoute } = await import(
	'../../../admin/organizers/organizers-route'
)

/**
 * The Organizer RPCs, plus the roster read (`ArtistClient.listByOrganizer`)
 * so each test sets up one Organizer's data in one place.
 */
interface MockOrganizerClient {
	create: ReturnType<typeof vi.fn>
	list: ReturnType<typeof vi.fn>
	get: ReturnType<typeof vi.fn>
	listByOrganizer: ReturnType<typeof vi.fn>
	associateArtist: ReturnType<typeof vi.fn>
	disassociateArtist: ReturnType<typeof vi.fn>
	deactivate: ReturnType<typeof vi.fn>
	delete: ReturnType<typeof vi.fn>
}

interface MockSearchClient {
	search: ReturnType<typeof vi.fn>
	create: ReturnType<typeof vi.fn>
}

function makeOrganizer(
	id: string,
	name: string,
	shortName = '',
	status = OrganizerStatus.UNSPECIFIED,
): Organizer {
	return create(OrganizerSchema, {
		id: { value: id },
		name: { value: name },
		...(shortName ? { shortName: { value: shortName } } : {}),
		status,
	})
}

function makeArtist(id: string, name: string): Artist {
	return create(ArtistSchema, {
		id: { value: id },
		name: { value: name },
	})
}

function createMockOrganizerClient(
	overrides: Partial<MockOrganizerClient> = {},
): MockOrganizerClient {
	return {
		create: vi.fn().mockResolvedValue(makeOrganizer('o-new', 'New Org')),
		list: vi.fn().mockResolvedValue([]),
		get: vi.fn().mockResolvedValue(makeOrganizer('o1', 'Org One')),
		listByOrganizer: vi.fn().mockResolvedValue([]),
		associateArtist: vi.fn().mockResolvedValue(undefined),
		disassociateArtist: vi.fn().mockResolvedValue(undefined),
		deactivate: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

function createMockSearchClient(
	overrides: Partial<MockSearchClient> = {},
): MockSearchClient {
	return {
		search: vi.fn().mockResolvedValue([]),
		create: vi.fn().mockResolvedValue(undefined),
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
			Registration.instance(IArtistClient, {
				search: searchClient.search,
				create: searchClient.create,
				listByOrganizer: client.listByOrganizer,
			}),
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
						makeOrganizer('o1', 'Org One', 'org-one'),
						makeOrganizer('o2', 'Org Two', 'org-two'),
					]),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			expect(vm.phase).toBe('ready')
			expect(vm.organizers).toHaveLength(2)
			expect(vm.organizers[0].name).toBe('Org One')
			expect(vm.organizers[0].shortName).toBe('org-one')
			expect(fixture.appHost.textContent).toContain('Org One')
			expect(fixture.appHost.textContent).toContain('Org Two')
			expect(fixture.appHost.textContent).toContain('org-two')
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
			expect(vm.loadError).toBe('Failed to load organizers.')
			expect(fixture.appHost.textContent).not.toContain('boom')
			expect(fixture.appHost.textContent).toContain('Could not load organizers')
		})
	})

	describe('create', () => {
		it('requires a name, a short name and an owner email', async () => {
			const client = createMockOrganizerClient()
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			vm.newName = '  '
			vm.newShortName = ''
			vm.newOwnerEmail = ''
			await vm.createOrganizer()

			expect(client.create).not.toHaveBeenCalled()
			expect(vm.createError).toContain('required')
		})

		it.each([
			[
				'a short name with a space',
				'XX Records',
				'owner@example.com',
				'short name',
			],
			['a reserved short name', 'admin', 'owner@example.com', 'short name'],
			['a malformed owner email', 'xx-records', 'band@', 'valid owner email'],
			[
				'an owner email over 165 characters',
				'xx-records',
				`${'a'.repeat(154)}@example.com`,
				'165 characters',
			],
		])(
			'refuses %s before sending',
			async (_label, shortName, email, message) => {
				const client = createMockOrganizerClient()
				const fixture = await build(client, createMockSearchClient())
				const vm = routeOf(fixture)

				vm.newName = 'XX Records'
				vm.newShortName = shortName
				vm.newOwnerEmail = email
				await vm.createOrganizer()

				expect(client.create).not.toHaveBeenCalled()
				expect(vm.createError).toContain(message)
			},
		)

		it('creates, clears the form, appends the row, and selects it', async () => {
			const created = makeOrganizer('o-new', 'XX Records', 'xx-records')
			const client = createMockOrganizerClient({
				create: vi.fn().mockResolvedValue(created),
				listByOrganizer: vi.fn().mockResolvedValue([]),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			vm.newName = 'XX Records'
			vm.newShortName = ' xx-records '
			vm.newOwnerEmail = 'owner@example.com'
			await vm.createOrganizer()

			expect(client.create).toHaveBeenCalledWith(
				'XX Records',
				'xx-records',
				'owner@example.com',
			)
			expect(vm.newName).toBe('')
			expect(vm.newShortName).toBe('')
			expect(vm.newOwnerEmail).toBe('')
			expect(vm.organizers.map((o) => o.id)).toContain('o-new')
			// Freshly created organizer becomes the selection + its roster loads.
			expect(vm.selected?.id).toBe('o-new')
			expect(vm.selected?.shortName).toBe('xx-records')
			expect(client.listByOrganizer).toHaveBeenCalledWith('o-new')
			await fixture.tasksSettled
			expect(fixture.appHost.textContent).toContain('Short name: xx-records')
		})

		it(`@spec ${ROUTE_SPEC} "Owner email not accepted"`, async () => {
			const client = createMockOrganizerClient({
				create: vi
					.fn()
					.mockRejectedValue(
						new ConnectError(
							'owner email was rejected by the identity provider (invalid_argument)',
							Code.InvalidArgument,
						),
					),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			vm.newName = 'x'
			vm.newShortName = 'xx-records'
			vm.newOwnerEmail = 'a@b.co'
			await vm.createOrganizer()
			await fixture.tasksSettled

			expect(vm.createError).toBe(
				'The sign-in service did not accept this owner email. Check it or use a different address.',
			)
			expect(fixture.appHost.textContent).toContain(vm.createError)
			expect(fixture.appHost.textContent).not.toContain('identity provider')
			// The form keeps its values so the admin can correct the email.
			expect(vm.newOwnerEmail).toBe('a@b.co')
			expect(vm.creating).toBe(false)
		})

		it(`@spec ${ROUTE_SPEC} "Create fails otherwise"`, async () => {
			const client = createMockOrganizerClient({
				create: vi
					.fn()
					.mockRejectedValue(
						new ConnectError(
							'provisioning is not finished (failed_precondition)',
							Code.FailedPrecondition,
						),
					),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			vm.newName = 'XX Records'
			vm.newShortName = 'xx-records'
			vm.newOwnerEmail = 'owner@example.com'
			await vm.createOrganizer()

			expect(vm.createError).toBe('Failed to create the organizer.')
			expect(vm.createError).not.toContain('deactivated')
		})

		it(`@spec ${ROUTE_SPEC} "Short name already used"`, async () => {
			const client = createMockOrganizerClient({
				create: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('short name is already used', Code.AlreadyExists),
					),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			vm.newName = 'Org'
			vm.newShortName = 'taken-name'
			vm.newOwnerEmail = 'fan@example.com'
			await vm.createOrganizer()

			expect(vm.createError).toBe(
				'That short name is already used by another organizer. Choose a different one.',
			)
			expect(vm.createError).not.toContain('artist')
			expect(vm.creating).toBe(false)
		})
	})

	describe('select + roster', () => {
		it('loads the roster for the selected organizer', async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
				listByOrganizer: vi
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

		it('shows a roster error when listByOrganizer fails', async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue([makeOrganizer('o1', 'Org One')]),
				listByOrganizer: vi.fn().mockRejectedValue(new Error('roster boom')),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)

			await vm.select(vm.organizers[0])

			expect(vm.detailPhase).toBe('error')
			expect(vm.detailError).toBe('Failed to load the roster.')
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
			expect(client.listByOrganizer).toHaveBeenCalledTimes(2)
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
				listByOrganizer: vi
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
				listByOrganizer: vi
					.fn()
					.mockResolvedValue([makeArtist('a1', 'Artist One')]),
				disassociateArtist: vi.fn().mockRejectedValue(new Error('remove boom')),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = routeOf(fixture)
			await vm.select(vm.organizers[0])

			await vm.disassociate(vm.artists[0])

			expect(vm.associateError).toBe('Failed to remove the artist.')
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

			expect(vm.associateError).toBe(
				'That artist is already represented by an organizer.',
			)
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

			expect(vm.searchError).toBe('Artist search failed.')
			expect(vm.searching).toBe(false)
		})
	})
})

const ROUTE_SPEC = 'components/infrastructure/admin/web/route/organizers'

type Fixture = Awaited<ReturnType<typeof build>>

/** Visible buttons whose text is exactly `label`, outside the delete dialog. */
function detailButtons(fixture: Fixture, label: string): HTMLButtonElement[] {
	return [
		...fixture.appHost.querySelectorAll<HTMLButtonElement>(
			'.organizers-detail button',
		),
	].filter((b) => b.textContent?.trim() === label)
}

function listStatusLabels(fixture: Fixture): string[] {
	return [
		...fixture.appHost.querySelectorAll(
			'.organizers-list .organizers-status-label',
		),
	].map((el) => el.textContent?.trim() ?? '')
}

function detailStatusLabel(fixture: Fixture): string {
	return (
		fixture.appHost
			.querySelector('.organizers-detail .organizers-status-label')
			?.textContent?.trim() ?? ''
	)
}

function dialogOf(fixture: Fixture): HTMLDialogElement {
	const dialog = fixture.appHost.querySelector('dialog')
	if (!dialog) throw new Error('delete dialog not rendered')
	return dialog
}

function dialogButton(fixture: Fixture, label: string): HTMLButtonElement {
	const button = [
		...dialogOf(fixture).querySelectorAll<HTMLButtonElement>('button'),
	].find((b) => b.textContent?.trim() === label)
	if (!button) throw new Error(`dialog button ${label} not rendered`)
	return button
}

/** The controls a deactivated Organizer refuses, as rendered in the detail. */
function refusedControls(fixture: Fixture) {
	const host = fixture.appHost
	return {
		remove: detailButtons(fixture, 'Remove').length,
		search: host.querySelectorAll('input[type="search"]').length,
		businessDetails: host.querySelectorAll('input[name="legalName"]').length,
		feeRate: host.querySelectorAll('input[name="platformFeeRate"]').length,
	}
}

async function selectFirst(fixture: Fixture, index = 0) {
	const vm = routeOf(fixture)
	await vm.select(vm.organizers[index])
	await fixture.tasksSettled
	return vm
}

describe('OrganizersRoute status and lifecycle', () => {
	// jsdom implements neither showModal nor close; model them so the dialog's
	// open state and its close event (Escape included) can be asserted.
	const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>
	const original = { showModal: proto.showModal, close: proto.close }

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useRealTimers()
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

	const everyStatus = () => [
		makeOrganizer(
			'o1',
			'Pending Org',
			'pending-org',
			OrganizerStatus.PROVISIONING,
		),
		makeOrganizer('o2', 'Live Org', 'live-org', OrganizerStatus.ACTIVE),
		makeOrganizer('o3', 'Old Org', 'old-org', OrganizerStatus.DEACTIVATED),
	]

	it(`@spec ${ROUTE_SPEC} "Organizers in every status"`, async () => {
		const client = createMockOrganizerClient({
			list: vi.fn().mockResolvedValue(everyStatus()),
		})
		const fixture = await build(client, createMockSearchClient())
		await fixture.tasksSettled

		expect(routeOf(fixture).organizers.map((o) => o.name)).toEqual([
			'Pending Org',
			'Live Org',
			'Old Org',
		])
		expect(listStatusLabels(fixture)).toEqual([
			'Provisioning',
			'Active',
			'Deactivated',
		])
	})

	async function expectDeactivateOffered(index: number, label: string) {
		const client = createMockOrganizerClient({
			list: vi.fn().mockResolvedValue(everyStatus()),
		})
		const fixture = await build(client, createMockSearchClient())
		await selectFirst(fixture, index)

		expect(detailStatusLabel(fixture)).toBe(label)
		expect(detailButtons(fixture, 'Deactivate')).toHaveLength(1)
		expect(detailButtons(fixture, 'Delete')).toHaveLength(0)
	}

	it(`@spec ${ROUTE_SPEC} "Active Organizer"`, async () => {
		await expectDeactivateOffered(1, 'Active')
	})

	it(`@spec ${ROUTE_SPEC} "Provisioning Organizer"`, async () => {
		await expectDeactivateOffered(0, 'Provisioning')
	})

	it(`@spec ${ROUTE_SPEC} "Deactivated Organizer"`, async () => {
		const client = createMockOrganizerClient({
			list: vi.fn().mockResolvedValue(everyStatus()),
		})
		const fixture = await build(client, createMockSearchClient())
		await selectFirst(fixture, 2)

		expect(detailStatusLabel(fixture)).toBe('Deactivated')
		expect(detailButtons(fixture, 'Delete')).toHaveLength(1)
		expect(detailButtons(fixture, 'Deactivate')).toHaveLength(0)
	})

	it('an unset status (older backend) shows no label and offers Deactivate as before', async () => {
		const client = createMockOrganizerClient({
			list: vi
				.fn()
				.mockResolvedValue([makeOrganizer('o1', 'Org One', 'org-one')]),
			listByOrganizer: vi
				.fn()
				.mockResolvedValue([makeArtist('a1', 'Artist One')]),
		})
		const fixture = await build(client, createMockSearchClient())
		await selectFirst(fixture)

		expect(listStatusLabels(fixture)).toEqual([])
		expect(detailStatusLabel(fixture)).toBe('')
		expect(detailButtons(fixture, 'Deactivate')).toHaveLength(1)
		expect(detailButtons(fixture, 'Delete')).toHaveLength(0)
		expect(refusedControls(fixture)).toEqual({
			remove: 1,
			search: 1,
			businessDetails: 1,
			feeRate: 1,
		})
	})

	it(`@spec ${ROUTE_SPEC} "Deactivated Organizer hides refused controls"`, async () => {
		const client = createMockOrganizerClient({
			list: vi.fn().mockResolvedValue(everyStatus()),
			listByOrganizer: vi
				.fn()
				.mockResolvedValue([makeArtist('a1', 'Artist One')]),
		})
		const fixture = await build(client, createMockSearchClient())
		await selectFirst(fixture, 2)

		// The represented Artists stay listed, without a Remove control.
		expect(fixture.appHost.textContent).toContain('Artist One')
		expect(refusedControls(fixture)).toEqual({
			remove: 0,
			search: 0,
			businessDetails: 0,
			feeRate: 0,
		})
		expect(detailButtons(fixture, 'Associate')).toHaveLength(0)
	})

	it(`@spec ${ROUTE_SPEC} "Active Organizer keeps every control"`, async () => {
		const client = createMockOrganizerClient({
			list: vi.fn().mockResolvedValue(everyStatus()),
			listByOrganizer: vi
				.fn()
				.mockResolvedValue([
					makeArtist('a1', 'Artist One'),
					makeArtist('a2', 'Artist Two'),
				]),
		})
		const fixture = await build(client, createMockSearchClient())
		const vm = await selectFirst(fixture, 1)
		vm.searchResults = [{ id: 'a9', name: 'Found Act' }]
		await fixture.tasksSettled

		expect(refusedControls(fixture)).toEqual({
			remove: 2,
			search: 1,
			businessDetails: 1,
			feeRate: 1,
		})
		expect(detailButtons(fixture, 'Associate')).toHaveLength(1)
	})

	describe('Deactivate', () => {
		it(`@spec ${ROUTE_SPEC} "Deactivate succeeds"`, async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue(everyStatus()),
				listByOrganizer: vi
					.fn()
					.mockResolvedValueOnce([makeArtist('a1', 'Artist One')])
					.mockResolvedValue([]),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = await selectFirst(fixture, 1)
			expect(detailStatusLabel(fixture)).toBe('Active')

			detailButtons(fixture, 'Deactivate')[0].click()
			await vi.waitFor(() => expect(vm.deactivating).toBe(false))
			await fixture.tasksSettled

			expect(client.deactivate).toHaveBeenCalledWith('o2')
			expect(listStatusLabels(fixture)[1]).toBe('Deactivated')
			expect(detailStatusLabel(fixture)).toBe('Deactivated')
			expect(detailButtons(fixture, 'Delete')).toHaveLength(1)
			expect(detailButtons(fixture, 'Deactivate')).toHaveLength(0)
			expect(refusedControls(fixture)).toMatchObject({
				search: 0,
				businessDetails: 0,
				feeRate: 0,
			})
			expect(vm.artists).toEqual([])
			expect(fixture.appHost.textContent).not.toContain('Artist One')
			expect(fixture.appHost.textContent).toContain(
				'This organizer represents no artists yet.',
			)
		})

		it(`@spec ${ROUTE_SPEC} "Deactivate fails"`, async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue(everyStatus()),
				deactivate: vi
					.fn()
					.mockRejectedValue(new ConnectError('try later', Code.Unavailable)),
			})
			const fixture = await build(client, createMockSearchClient())
			const vm = await selectFirst(fixture, 1)

			await vm.deactivate()
			await fixture.tasksSettled

			expect(vm.deactivateError).not.toBe('')
			expect(
				fixture.appHost.querySelector('.organizers-detail [role="alert"]')
					?.textContent,
			).toContain(vm.deactivateError)
			expect(detailStatusLabel(fixture)).toBe('Active')
			expect(detailButtons(fixture, 'Deactivate')).toHaveLength(1)
			expect(detailButtons(fixture, 'Delete')).toHaveLength(0)
		})
	})

	describe('Delete', () => {
		const fanTest = () => [
			makeOrganizer('o1', 'Live Org', 'live-org', OrganizerStatus.ACTIVE),
			makeOrganizer('o2', 'Fan Test', 'fan-test', OrganizerStatus.DEACTIVATED),
		]

		async function openDialog(client: MockOrganizerClient) {
			const fixture = await build(client, createMockSearchClient())
			const vm = await selectFirst(fixture, 1)
			detailButtons(fixture, 'Delete')[0].click()
			await fixture.tasksSettled
			return { fixture, vm }
		}

		it(`@spec ${ROUTE_SPEC} "Confirm deletes"`, async () => {
			let resolveDelete: () => void = () => {}
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue(fanTest()),
				delete: vi.fn().mockImplementation(
					() =>
						new Promise<void>((resolve) => {
							resolveDelete = resolve
						}),
				),
			})
			const { fixture, vm } = await openDialog(client)
			expect(client.delete).not.toHaveBeenCalled()

			const confirm = dialogButton(fixture, 'Delete')
			confirm.click()
			await fixture.tasksSettled
			// In flight: the control is disabled and a second activation sends nothing.
			expect(dialogButton(fixture, 'Deleting…').disabled).toBe(true)
			confirm.click()
			resolveDelete()
			await vi.waitFor(() => expect(vm.deleting).toBe(false))

			expect(client.delete).toHaveBeenCalledTimes(1)
			expect(client.delete).toHaveBeenCalledWith('o2')
		})

		it.each([
			['Escape', (dialog: HTMLDialogElement) => dialog.close()],
			[
				'Cancel',
				(_dialog: HTMLDialogElement, fixture: Fixture) =>
					dialogButton(fixture, 'Cancel').click(),
			],
		])(
			`@spec ${ROUTE_SPEC} "Dismiss keeps the Organizer" (%s)`,
			async (_how, dismiss) => {
				const client = createMockOrganizerClient({
					list: vi.fn().mockResolvedValue(fanTest()),
				})
				const { fixture, vm } = await openDialog(client)
				const dialog = dialogOf(fixture)
				expect(dialog.hasAttribute('open')).toBe(true)

				// A browser closes a modal dialog on Escape and fires `close`;
				// the stubbed close() does the same.
				dismiss(dialog, fixture)
				await fixture.tasksSettled

				expect(dialog.hasAttribute('open')).toBe(false)
				expect(vm.pendingDelete).toBeNull()
				expect(client.delete).not.toHaveBeenCalled()
				expect(vm.organizers.map((o) => o.shortName)).toContain('fan-test')
			},
		)

		it(`@spec ${ROUTE_SPEC} "Dialog names the Organizer"`, async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue(fanTest()),
			})
			const { fixture } = await openDialog(client)
			const dialog = dialogOf(fixture)

			expect(dialog.textContent).toContain('Fan Test')
			expect(dialog.textContent).toContain('fan-test')
			expect(dialog.textContent).toContain('permanently')
			expect(document.activeElement).toBe(dialogButton(fixture, 'Cancel'))
		})

		it(`@spec ${ROUTE_SPEC} "Delete succeeds"`, async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue(fanTest()),
			})
			const { fixture, vm } = await openDialog(client)

			await vm.confirmDelete()
			await fixture.tasksSettled

			expect(dialogOf(fixture).hasAttribute('open')).toBe(false)
			expect(vm.organizers.map((o) => o.id)).toEqual(['o1'])
			expect(vm.selected).toBeNull()
			expect(
				fixture.appHost.querySelector('.organizers-list')?.textContent,
			).not.toContain('Fan Test')
			expect(fixture.appHost.textContent).toContain(
				'Select an organizer to inspect its represented artists.',
			)
		})

		it(`@spec ${ROUTE_SPEC} "Delete blocked by an order"`, async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue(fanTest()),
				delete: vi
					.fn()
					.mockRejectedValue(
						new ConnectError(
							'an event has a paid order',
							Code.FailedPrecondition,
						),
					),
			})
			const { fixture, vm } = await openDialog(client)

			await vm.confirmDelete()
			await fixture.tasksSettled

			expect(dialogOf(fixture).hasAttribute('open')).toBe(false)
			expect(vm.organizers.map((o) => o.id)).toContain('o2')
			expect(vm.selected?.id).toBe('o2')
			const detail = fixture.appHost.querySelector('.organizers-detail')
			expect(vm.deleteError).toBe(
				'This organizer cannot be deleted while it has a paid order, a settlement that is not reversed, a purchase in progress, or a payout account.',
			)
			expect(detail?.textContent).toContain(vm.deleteError)
			expect(detail?.textContent).not.toContain('an event has')
		})

		it(`@spec ${ROUTE_SPEC} "Delete fails otherwise"`, async () => {
			const client = createMockOrganizerClient({
				list: vi.fn().mockResolvedValue(fanTest()),
				delete: vi
					.fn()
					.mockRejectedValue(new ConnectError('try later', Code.Unavailable)),
			})
			const { fixture, vm } = await openDialog(client)

			await vm.confirmDelete()
			await fixture.tasksSettled

			expect(vm.organizers.map((o) => o.id)).toContain('o2')
			expect(vm.selected?.id).toBe('o2')
			expect(vm.deleteError).toBe('Failed to delete the organizer.')
			const alert = fixture.appHost.querySelector(
				'.organizers-detail [role="alert"]',
			)?.textContent
			expect(alert).toContain('Failed to delete the organizer.')
			expect(alert).not.toContain('try later')
		})
	})
})

describe('OrganizersRoute test artist and artist concerts', () => {
	const MBID_V4 =
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useRealTimers()
	})

	async function buildSelected(
		client: MockOrganizerClient,
		searchClient: MockSearchClient,
	) {
		const fixture = await build(client, searchClient)
		const vm = routeOf(fixture)
		await vm.select(vm.organizers[0])
		await fixture.tasksSettled
		return { fixture, vm }
	}

	it(`@spec ${ROUTE_SPEC} "Test artist created and associated"`, async () => {
		const client = createMockOrganizerClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeOrganizer('o1', 'Live Org', 'live-org', OrganizerStatus.ACTIVE),
				]),
		})
		const searchClient = createMockSearchClient({
			create: vi
				.fn()
				.mockResolvedValue(makeArtist('a-test', 'E2E Test Artist')),
		})
		const { fixture, vm } = await buildSelected(client, searchClient)
		expect(fixture.appHost.textContent).toContain(
			'Use a name no real artist uses.',
		)

		vm.testArtistName = ' E2E Test Artist '
		await vm.createTestArtist()
		await fixture.tasksSettled

		expect(searchClient.create).toHaveBeenCalledTimes(1)
		const [name, mbid] = searchClient.create.mock.calls[0]
		expect(name).toBe('E2E Test Artist')
		expect(mbid).toMatch(MBID_V4)
		expect(client.associateArtist).toHaveBeenCalledWith('o1', 'a-test')
		expect(vm.artists.map((a) => a.name)).toContain('E2E Test Artist')
		expect(vm.testArtistName).toBe('')
		expect(
			fixture.appHost.querySelector('.organizers-roster-list')?.textContent,
		).toContain('E2E Test Artist')
	})

	it(`@spec ${ROUTE_SPEC} "Association fails after registration"`, async () => {
		const client = createMockOrganizerClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeOrganizer('o1', 'Live Org', 'live-org', OrganizerStatus.ACTIVE),
				]),
			associateArtist: vi
				.fn()
				.mockRejectedValueOnce(
					new ConnectError('unavailable', Code.Unavailable),
				)
				.mockResolvedValueOnce(undefined),
		})
		const searchClient = createMockSearchClient({
			create: vi
				.fn()
				.mockResolvedValue(makeArtist('a-test', 'E2E Test Artist')),
		})
		const { fixture, vm } = await buildSelected(client, searchClient)

		vm.testArtistName = 'E2E Test Artist'
		await vm.createTestArtist()
		await fixture.tasksSettled

		expect(vm.testArtistError).toContain('Retry to associate it')
		expect(fixture.appHost.textContent).toContain('Retry association')
		expect(vm.artists).toHaveLength(0)

		await vm.createTestArtist()

		expect(searchClient.create).toHaveBeenCalledTimes(1)
		expect(client.associateArtist).toHaveBeenCalledTimes(2)
		expect(client.associateArtist).toHaveBeenLastCalledWith('o1', 'a-test')
		expect(vm.artists.map((a) => a.id)).toEqual(['a-test'])
		expect(vm.testArtistError).toBe('')
	})

	it(`@spec ${ROUTE_SPEC} "Empty name"`, async () => {
		const client = createMockOrganizerClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeOrganizer('o1', 'Live Org', 'live-org', OrganizerStatus.ACTIVE),
				]),
		})
		const searchClient = createMockSearchClient()
		const { fixture, vm } = await buildSelected(client, searchClient)

		vm.testArtistName = '   '
		await vm.createTestArtist()
		await fixture.tasksSettled

		expect(searchClient.create).not.toHaveBeenCalled()
		expect(client.associateArtist).not.toHaveBeenCalled()
		expect(vm.testArtistError).toBe('Enter a name for the test artist.')
	})

	it('does not offer a test artist for a deactivated organizer', async () => {
		const client = createMockOrganizerClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeOrganizer(
						'o1',
						'Old Org',
						'old-org',
						OrganizerStatus.DEACTIVATED,
					),
				]),
		})
		const { fixture } = await buildSelected(client, createMockSearchClient())

		expect(fixture.appHost.textContent).not.toContain('Create test artist')
	})

	it(`@spec ${ROUTE_SPEC} "Open an artist's concerts"`, async () => {
		const client = createMockOrganizerClient({
			list: vi
				.fn()
				.mockResolvedValue([
					makeOrganizer(
						'o1',
						'Old Org',
						'old-org',
						OrganizerStatus.DEACTIVATED,
					),
				]),
			listByOrganizer: vi
				.fn()
				.mockResolvedValue([makeArtist('a1', 'Artist One')]),
		})
		const { fixture } = await buildSelected(client, createMockSearchClient())

		const link = fixture.appHost.querySelector<HTMLAnchorElement>(
			'.organizers-roster-link',
		)
		expect(link?.textContent?.trim()).toBe('Artist One')
		// Without the router the interpolated `load` lands on the element; the
		// router's load attribute reads the same value. It carries the id only.
		expect((link as unknown as { load?: string } | null)?.load).toBe(
			'../artists/a1/concerts',
		)
	})
})
