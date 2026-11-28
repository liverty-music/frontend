import { Code, ConnectError } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Snack } from '../../../shared/ui/snack-bar/snack'
import type { Artist } from '../../../src/entities/artist'
import { SearchController } from '../../../src/routes/discovery/search-controller'
import { createCatalogI18n } from '../../helpers/catalog-i18n'
import { createMockLogger } from '../../helpers/mock-logger'

function makeArtist(id: string, name: string): Artist {
	return { id, name, mbid: '' }
}

interface Request {
	query: string
	signal: AbortSignal
	resolve(artists: Artist[]): void
	reject(error: unknown): void
}

/** Lets the controller run what follows a settled request. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('SearchController', () => {
	let sut: SearchController
	let requests: Request[]
	let published: Snack[]
	const callbacks = {
		onEnterSearchMode: vi.fn(),
		onExitSearchMode: vi.fn(),
		onSearchCompleted: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
		requests = []
		published = []
		sut = new SearchController(
			{
				search: (query, signal) =>
					new Promise<Artist[]>((resolve, reject) => {
						requests.push({ query, signal, resolve, reject })
					}),
			},
			{ publish: (snack: unknown) => published.push(snack as Snack) },
			createCatalogI18n() as never,
			callbacks,
			createMockLogger(),
		)
	})

	/** A query that has been sent. */
	function send(query: string): Request {
		sut.searchQuery = query
		sut.submit()
		return requests[requests.length - 1]
	}

	describe('a query change', () => {
		it('waits to send a searchable query, in search mode', () => {
			sut.searchQuery = 'vaundy'

			expect(sut.phase).toBe('waiting')
			expect(sut.isSearchMode).toBe(true)
			expect(callbacks.onEnterSearchMode).toHaveBeenCalled()
			expect(requests).toHaveLength(0)
		})

		it.each(['a', 'Z', '7', ' a '])(
			'stays idle on the single letter or digit %j',
			(query) => {
				sut.searchQuery = query
				sut.submit()
				sut.searchNow()

				expect(sut.phase).toBe('idle')
				expect(sut.isSearchMode).toBe(true)
				expect(requests).toHaveLength(0)
			},
		)

		it.each(['嵐', 'ａ', '&', 'ab'])('searches the query %j', (query) => {
			expect(send(query).query).toBe(query)
		})

		it('sends the query without the white space around it', () => {
			expect(send('  vaundy ').query).toBe('vaundy')
		})

		it('clears the results on a single letter or digit', async () => {
			send('ab').resolve([makeArtist('a1', 'A')])
			await settle()

			sut.searchQuery = 'a'

			expect(sut.searchResults).toHaveLength(0)
		})

		it('leaves search mode and clears the results on an empty query', async () => {
			send('vaundy').resolve([makeArtist('a1', 'Vaundy')])
			await settle()

			sut.clearSearch()

			expect(sut.searchQuery).toBe('')
			expect(sut.phase).toBe('idle')
			expect(sut.isSearchMode).toBe(false)
			expect(sut.searchResults).toHaveLength(0)
			expect(callbacks.onExitSearchMode).toHaveBeenCalled()
		})

		it('changes nothing when only the surrounding white space changes', async () => {
			const request = send('vaundy')
			sut.searchQuery = 'vaundy '

			expect(sut.phase).toBe('searching')
			expect(request.signal.aborted).toBe(false)
		})

		it('cancels the outstanding request', () => {
			const request = send('vau')

			sut.searchQuery = 'vaundy'

			expect(request.signal.aborted).toBe(true)
			expect(sut.phase).toBe('waiting')
		})
	})

	describe('sending', () => {
		it('does not send a query again while it is being answered', () => {
			send('vaundy')
			sut.submit()
			sut.searchNow()

			expect(sut.phase).toBe('searching')
			expect(requests).toHaveLength(1)
		})

		it('does not send an answered query again', async () => {
			send('vaundy').resolve([])
			await settle()
			sut.submit()
			sut.searchNow()

			expect(requests).toHaveLength(1)
		})

		it('sends a failed query again on Enter only', async () => {
			send('vaundy').reject(new ConnectError('down', Code.Unavailable))
			await settle()

			sut.submit()
			expect(requests).toHaveLength(1)

			sut.searchNow()
			expect(requests).toHaveLength(2)
			expect(sut.phase).toBe('searching')
		})
	})

	describe('an outcome', () => {
		it('is answered with the results, and reported', async () => {
			const results = [makeArtist('a1', 'A'), makeArtist('a2', 'B')]
			send('beatles').resolve(results)
			await settle()

			expect(sut.phase).toBe('answered')
			expect(sut.searchResults).toEqual(results)
			expect(callbacks.onSearchCompleted).toHaveBeenCalledExactlyOnceWith({
				queryLength: 7,
				resultCount: 2,
			})
		})

		it('is answered with no artists on NotFound, without a snack', async () => {
			send('zzzz').reject(new ConnectError('no artist', Code.NotFound))
			await settle()

			expect(sut.phase).toBe('answered')
			expect(sut.searchResults).toHaveLength(0)
			expect(published).toHaveLength(0)
			expect(callbacks.onSearchCompleted).toHaveBeenCalledExactlyOnceWith({
				queryLength: 4,
				resultCount: 0,
			})
		})

		it.each([
			new ConnectError('timeout', Code.DeadlineExceeded),
			new Error('network'),
		])('is failed on %s, with one replaceable snack', async (error) => {
			send('ab').resolve([makeArtist('a1', 'A')])
			await settle()
			vi.clearAllMocks()

			send('abc').reject(error)
			await settle()

			expect(sut.phase).toBe('failed')
			expect(sut.searchResults).toHaveLength(0)
			expect(callbacks.onSearchCompleted).not.toHaveBeenCalled()
			expect(published).toHaveLength(1)
			expect(published[0].severity).toBe('warning')
			expect(published[0].replaceKey).toBe('discovery-search-failed')
		})

		it.each([
			['success', (r: Request) => r.resolve([makeArtist('a1', 'Stale')])],
			[
				'NotFound',
				(r: Request) => r.reject(new ConnectError('none', Code.NotFound)),
			],
			[
				'failure',
				(r: Request) => r.reject(new ConnectError('gone', Code.Canceled)),
			],
		])('of a cancelled request is ignored: %s', async (_name, finish) => {
			const stale = send('first')
			sut.searchQuery = 'second'

			finish(stale)
			await settle()

			expect(sut.phase).toBe('waiting')
			expect(sut.searchResults).toHaveLength(0)
			expect(published).toHaveLength(0)
			expect(callbacks.onSearchCompleted).not.toHaveBeenCalled()
		})
	})

	describe('dispose', () => {
		it('cancels the outstanding request', () => {
			const request = send('vaundy')

			sut.dispose()

			expect(request.signal.aborted).toBe(true)
			expect(sut.phase).toBe('idle')
		})

		it('sends nothing that was still waiting', () => {
			sut.searchQuery = 'vaundy'

			sut.dispose()
			sut.submit()

			expect(requests).toHaveLength(0)
		})
	})
})
