import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../../helpers/create-container'

// Interfaces only: the context binds to test doubles, not to Connect clients.
const mockIOrganizerClient = DI.createInterface('IOrganizerClient')
const mockIArtistClient = DI.createInterface('IArtistClient')

vi.mock('../../../organizer/services/organizer-client', () => ({
	IOrganizerClient: mockIOrganizerClient,
}))
vi.mock('../../../organizer/services/artist-client', () => ({
	IArtistClient: mockIArtistClient,
}))

const { IConsoleContext } = await import(
	'../../../organizer/shell/console-context'
)
const { ConsoleContextHook } = await import(
	'../../../organizer/shell/console-context-hook'
)
const { destinationOf } = await import(
	'../../../organizer/shell/console-navigation/console-navigation'
)
const { editorOfMethod } = await import(
	'../../../organizer/sale-editor/sale-editor-route'
)

const artist = (id: string, name: string) => ({
	id: { value: id },
	name: { value: name },
})

function build(
	options: {
		organizerId?: string
		artists?: ReturnType<typeof artist>[] | Error
		organizerError?: Error
	} = {},
) {
	const organizers = {
		get: vi.fn(async () => {
			if (options.organizerError) throw options.organizerError
			return {
				id: { value: options.organizerId ?? 'org-1' },
				name: { value: 'XX Records' },
			}
		}),
	}
	const artists = {
		list: vi.fn(async () => {
			if (options.artists instanceof Error) throw options.artists
			return (
				options.artists ?? [artist('a-2', 'Band B'), artist('a-1', 'Band A')]
			)
		}),
	}
	const container = createTestContainer(
		Registration.instance(mockIOrganizerClient, organizers),
		Registration.instance(mockIArtistClient, artists),
	)
	container.register(ConsoleContextHook)
	return {
		context: container.get(IConsoleContext),
		hook: container.get(ConsoleContextHook),
		organizers,
		artists,
	}
}

describe('ConsoleContext', () => {
	beforeEach(() => localStorage.clear())

	it('reads the Organizer and its Artists once, the Artists by name', async () => {
		const { context, organizers } = build()
		await Promise.all([context.load(), context.load()])
		expect(organizers.get).toHaveBeenCalledTimes(1)
		expect(context.organizerName).toBe('XX Records')
		expect(context.artists.map((a) => a.name?.value)).toEqual([
			'Band A',
			'Band B',
		])
	})

	it('works on the Artist in the address, else the last opened, else the first', async () => {
		const { context } = build()
		await context.load()
		expect(context.artistId).toBe('a-1')
		expect(context.concertsHref).toBe('/organizers/org-1/artists/a-1/series')

		context.follow({ organizerId: 'org-1', artistId: 'a-2' })
		expect(context.artistId).toBe('a-2')

		// Home names no Artist: 公演 keeps opening the one last opened.
		context.follow({ organizerId: 'org-1' })
		expect(context.artistId).toBe('a-2')
		expect(context.concertsHref).toBe('/organizers/org-1/artists/a-2/series')

		// Remembered on this device for the next visit.
		const next = build()
		await next.context.load()
		expect(next.context.artistId).toBe('a-2')
	})

	it('ignores a remembered Artist the Organizer no longer represents', async () => {
		localStorage.setItem('liverty:organizer:last-artist:org-1', 'gone')
		const { context } = build()
		await context.load()
		expect(context.artistId).toBe('a-1')
	})

	it('opens the no-Artist 公演 page when no Artist is represented', async () => {
		const { context } = build({ artists: [] })
		await context.load()
		expect(context.artistId).toBe('')
		expect(context.concertsHref).toBe('/organizers/org-1/artists')
	})

	it('retries the Organizer read after it failed', async () => {
		const { context, organizers } = build({ organizerError: new Error('down') })
		await expect(context.load()).rejects.toThrow('down')
		await expect(context.load()).rejects.toThrow('down')
		expect(organizers.get).toHaveBeenCalledTimes(2)
	})
})

describe('ConsoleContextHook', () => {
	beforeEach(() => localStorage.clear())

	it('admits an address naming the caller’s Organizer', async () => {
		const { hook } = build()
		const result = await hook.canLoad(
			{} as never,
			{ organizerId: 'org-1' },
			{} as never,
			null,
		)
		expect(result).toBe(true)
	})

	it('opens the other-Organizer page for another Organizer’s address', async () => {
		const { hook } = build()
		const result = await hook.canLoad(
			{} as never,
			{ organizerId: 'org-9', artistId: 'a-1' },
			{} as never,
			null,
		)
		expect(result).toBe('/other-organizer')
	})

	it('leaves screens without an Organizer in their address alone', async () => {
		const { hook, organizers } = build()
		const result = await hook.canLoad({} as never, {}, {} as never, null)
		expect(result).toBe(true)
		expect(organizers.get).not.toHaveBeenCalled()
	})

	it('lets the screen open when the Organizer cannot be read', async () => {
		const { hook } = build({ organizerError: new Error('down') })
		const result = await hook.canLoad(
			{} as never,
			{ organizerId: 'org-9' },
			{} as never,
			null,
		)
		expect(result).toBe(true)
	})

	it('follows the Artist of the address once the screen loads', async () => {
		const { hook, context } = build()
		await context.load()
		hook.loading({} as never, { organizerId: 'org-1', artistId: 'a-2' })
		expect(context.addressArtistId).toBe('a-2')
		expect(context.scope).toEqual({ organizer: 'org-1', artist: 'a-2' })
	})
})

describe('console addresses', () => {
	it('marks the destination of an address under the Organizer', () => {
		expect(destinationOf('/organizers/o1')).toBe('home')
		expect(destinationOf('/organizers/o1/artists')).toBe('concerts')
		expect(
			destinationOf('/organizers/o1/artists/a1/series/s1/events/e1/scanners'),
		).toBe('concerts')
		expect(destinationOf('/organizers/o1/settings')).toBe('settings')
		expect(destinationOf('/concerts')).toBe('home')
	})

	it('picks the sale editor of a method', () => {
		expect(editorOfMethod('lottery')).toBe('lottery')
		expect(editorOfMethod('first-come')).toBe('firstCome')
		expect(editorOfMethod(null)).toBeNull()
		expect(editorOfMethod('auction')).toBeNull()
	})
})
