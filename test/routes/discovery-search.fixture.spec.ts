import { I18N, I18nConfiguration } from '@aurelia/i18n'
import { createFixture } from '@aurelia/testing'
import { Code, ConnectError } from '@connectrpc/connect'
import { IEventAggregator, resolve } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SNACK_LONG_MS } from '../../shared/ui/snack-bar/snack'
import { SnackBar } from '../../shared/ui/snack-bar/snack-bar'
import { StatePlaceholder } from '../../src/components/state-placeholder/state-placeholder'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import type { Artist } from '../../src/entities/artist'
import ja from '../../src/locales/ja/translation.json'
import { DiscoverySearchBar } from '../../src/routes/discovery/discovery-search-bar'
import { DiscoverySearchResults } from '../../src/routes/discovery/discovery-search-results'
import { SearchController } from '../../src/routes/discovery/search-controller'
import { createMockLogger } from '../helpers/mock-logger'

/**
 * Discovery's search as the fan meets it: the real search bar, result list,
 * snack bar and search controller, with only the search request faked.
 */

// jsdom has no popover; a shown snack is a popover.
HTMLElement.prototype.showPopover ??= () => {}
HTMLElement.prototype.hidePopover ??= () => {}

interface Request {
	query: string
	signal: AbortSignal
	resolve(artists: Artist[]): void
	reject(error: unknown): void
}

const artist = (id: string, name: string): Artist => ({ id, name, mbid: '' })
const timeout = () => new ConnectError('timeout', Code.DeadlineExceeded)

async function mount() {
	const requests: Request[] = []
	const onExitSearchMode = vi.fn()
	const client = {
		search: (query: string, signal: AbortSignal) =>
			new Promise<Artist[]>((resolve, reject) => {
				requests.push({ query, signal, resolve, reject })
			}),
	}

	/** The shell's part: the snack bar outlives the screen. */
	class Host {
		public onDiscovery = true
		public readonly search = new SearchController(
			client,
			resolve(IEventAggregator),
			resolve(I18N),
			{
				onEnterSearchMode: () => {},
				onExitSearchMode,
				onSearchCompleted: () => {},
			},
			createMockLogger(),
		)
	}

	const fixture = await createFixture
		.html(`
			<template if.bind="onDiscovery">
				<discovery-search-bar search.bind="search" search-clear.trigger="search.clearSearch()"></discovery-search-bar>
				<discovery-search-results search.bind="search"></discovery-search-results>
			</template>
			<snack-bar></snack-bar>
		`)
		.component(Host)
		.deps(
			DiscoverySearchBar,
			DiscoverySearchResults,
			StatePlaceholder,
			BusyOnClickCustomAttribute,
			SnackBar,
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng: 'ja',
					resources: { ja: { translation: ja } },
					fallbackLng: 'ja',
				}
			}),
		)
		.build().started

	const host = fixture.appHost
	const find = (selector: string) => host.querySelector<HTMLElement>(selector)

	/**
	 * Runs the clock and what it queues. Not `tasksSettled()`: that waits for a
	 * pending debounced call, which only this clock can run.
	 */
	async function pass(ms = 0): Promise<void> {
		await vi.advanceTimersByTimeAsync(ms)
	}

	const input = () => find('input') as HTMLInputElement

	return {
		requests,
		onExitSearchMode,
		search: fixture.component.search,
		input,
		pass,
		async type(value: string): Promise<void> {
			input().value = value
			input().dispatchEvent(new Event('input', { bubbles: true }))
			await pass()
		},
		async enter(init: KeyboardEventInit = {}): Promise<void> {
			input().dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Enter',
					bubbles: true,
					...init,
				}),
			)
			await pass()
		},
		async clear(): Promise<void> {
			find('.clear-button')?.click()
			await pass()
		},
		/** The fan goes to another screen, as the route's `detaching` does. */
		async leave(): Promise<void> {
			fixture.component.search.dispose()
			fixture.component.onDiscovery = false
			await pass()
		},
		names: () =>
			[...host.querySelectorAll('.result-name')].map((el) =>
				el.textContent?.trim(),
			),
		loading: () => find('.skeleton-row') !== null,
		noResults: () => find('.search-status') !== null,
		clearButton: () => find('.clear-button'),
		snacks: () =>
			[...host.querySelectorAll('snack-item')].map((el) =>
				el.textContent?.trim(),
			),
		stop: () => fixture.stop(true),
	}
}

describe('Discovery search', () => {
	let screen: Awaited<ReturnType<typeof mount>>

	beforeEach(async () => {
		vi.useFakeTimers()
		screen = await mount()
	})

	afterEach(async () => {
		await screen.stop()
		vi.useRealTimers()
	})

	/** Types a query and waits until it is sent. */
	async function send(query: string): Promise<Request> {
		await screen.type(query)
		await screen.pass(2000)
		return screen.requests[screen.requests.length - 1]
	}

	async function answer(request: Request, artists: Artist[]): Promise<void> {
		request.resolve(artists)
		await screen.pass()
	}

	async function fail(request: Request, error: unknown): Promise<void> {
		request.reject(error)
		await screen.pass()
	}

	describe('when a search is sent', () => {
		it('@spec components/infrastructure/fan/web/route/discovery "Search is debounced"', async () => {
			await screen.type('Vaun')
			await screen.pass(1999)
			expect(screen.requests).toHaveLength(0)

			// Typing again within 2000 ms postpones the request.
			await screen.type('Vaundy')
			await screen.pass(1999)
			expect(screen.requests).toHaveLength(0)

			await screen.pass(1)
			expect(screen.requests.map((r) => r.query)).toEqual(['Vaundy'])
			await screen.pass(10_000)
			expect(screen.requests).toHaveLength(1)
		})

		it('@spec components/infrastructure/fan/web/route/discovery "Enter searches at once"', async () => {
			await screen.type('Vaundy')
			await screen.pass(500)

			await screen.enter()
			expect(screen.requests.map((r) => r.query)).toEqual(['Vaundy'])

			await screen.pass(2000)
			expect(screen.requests).toHaveLength(1)
		})

		it('@spec components/infrastructure/fan/web/route/discovery "Enter on an answered query"', async () => {
			await answer(await send('Vaundy'), [artist('a1', 'Vaundy')])

			await screen.enter()

			expect(screen.requests).toHaveLength(1)
		})

		it.each<[string, KeyboardEventInit]>([
			['isComposing', { isComposing: true }],
			['key code 229', { keyCode: 229 }],
		])(
			'@spec components/infrastructure/fan/web/route/discovery "Enter that confirms a conversion" (%s)',
			async (_how, init) => {
				await screen.type('ばうんでぃ')

				await screen.enter(init)

				expect(screen.requests).toHaveLength(0)
			},
		)

		it.each(['a', '7'])(
			'@spec components/infrastructure/fan/web/route/discovery "Single letter or digit" (%s)',
			async (query) => {
				await screen.type(query)
				await screen.pass(2000)
				await screen.enter()

				expect(screen.requests).toHaveLength(0)
				expect(screen.names()).toEqual([])
				expect(screen.loading()).toBe(false)
				expect(screen.noResults()).toBe(false)
				// The screen is in search mode all the same.
				expect(screen.search.isSearchMode).toBe(true)
			},
		)

		it('@spec components/infrastructure/fan/web/route/discovery "Single non-Latin character"', async () => {
			await send('嵐')

			expect(screen.requests.map((r) => r.query)).toEqual(['嵐'])
		})

		it('sends nothing for a change of surrounding white space only', async () => {
			await answer(await send('Vaundy'), [artist('a1', 'Vaundy')])

			await send(' Vaundy  ')

			expect(screen.requests).toHaveLength(1)
			expect(screen.names()).toEqual(['Vaundy'])
		})
	})

	describe('progress', () => {
		it('@spec components/infrastructure/fan/web/route/discovery "Typing before the search is sent"', async () => {
			await screen.type('Va')

			expect(screen.search.isSearchMode).toBe(true)
			expect(screen.clearButton()).not.toBeNull()
			expect(screen.loading()).toBe(true)
			expect(screen.noResults()).toBe(false)

			await screen.pass(2000)
			expect(screen.loading()).toBe(true)
			expect(screen.noResults()).toBe(false)
		})

		it('@spec components/infrastructure/fan/web/route/discovery "Refining a query with results"', async () => {
			await answer(await send('Vaun'), [artist('a1', 'Vaundy')])

			await screen.type('Vaundy')
			expect(screen.names()).toEqual(['Vaundy'])
			expect(screen.loading()).toBe(false)

			const next = await send('Vaundy')
			expect(screen.names()).toEqual(['Vaundy'])

			await answer(next, [artist('a2', 'Vaundy Band')])
			expect(screen.names()).toEqual(['Vaundy Band'])
		})
	})

	describe('a superseded search', () => {
		it('@spec components/infrastructure/fan/web/route/discovery "Stale search response is discarded"', async () => {
			const older = await send('Furui')
			const newer = await send('Furui riho')
			expect(older.signal.aborted).toBe(true)
			expect(newer.signal.aborted).toBe(false)

			await answer(newer, [artist('a2', 'Furui Riho')])
			await answer(older, [artist('a1', 'Furui')])

			expect(screen.names()).toEqual(['Furui Riho'])
		})

		it('@spec components/infrastructure/fan/web/route/discovery "Stale search fails after the newer one answered"', async () => {
			const older = await send('Furui')
			const newer = await send('Furui riho')
			await answer(newer, [artist('a2', 'Furui Riho')])

			await fail(older, timeout())

			expect(screen.names()).toEqual(['Furui Riho'])
			expect(screen.snacks()).toEqual([])
		})

		it.each([
			['cleared', 'waiting'],
			['cleared', 'being answered'],
			['left', 'waiting'],
			['left', 'being answered'],
		] as const)(
			'@spec components/infrastructure/fan/web/route/discovery "Cleared or left while a search is outstanding" (%s while %s)',
			async (how, when) => {
				await screen.type('Vaundy')
				if (when === 'being answered') await screen.pass(2000)

				if (how === 'cleared') await screen.clear()
				else await screen.leave()
				await screen.pass(2000)

				if (when === 'waiting') {
					expect(screen.requests).toHaveLength(0)
				} else {
					expect(screen.requests).toHaveLength(1)
					expect(screen.requests[0].signal.aborted).toBe(true)
					await fail(screen.requests[0], timeout())
				}
				expect(screen.names()).toEqual([])
				expect(screen.loading()).toBe(false)
				expect(screen.noResults()).toBe(false)
				expect(screen.snacks()).toEqual([])
			},
		)

		it('@spec components/infrastructure/fan/web/route/discovery "Clear search restores Artists view"', async () => {
			await answer(await send('Vaundy'), [artist('a1', 'Vaundy')])

			await screen.clear()

			expect(screen.input().value).toBe('')
			expect(screen.search.isSearchMode).toBe(false)
			expect(screen.onExitSearchMode).toHaveBeenCalled()
			expect(screen.names()).toEqual([])
		})
	})

	describe('outcome', () => {
		it('@spec components/infrastructure/fan/web/route/discovery "No artist found"', async () => {
			await fail(
				await send('zzzz'),
				new ConnectError('no artist', Code.NotFound),
			)

			expect(screen.noResults()).toBe(true)
			expect(screen.loading()).toBe(false)
			expect(screen.snacks()).toEqual([])
		})

		it('@spec components/infrastructure/fan/web/route/discovery "Search times out"', async () => {
			await fail(await send('Vaundy'), timeout())

			expect(screen.snacks()).toEqual([ja.discovery.searchFailed])
			expect(screen.names()).toEqual([])
			expect(screen.loading()).toBe(false)
			expect(screen.noResults()).toBe(false)
		})

		it('@spec components/infrastructure/fan/web/route/discovery "Searches fail one after another"', async () => {
			for (const query of ['first', 'second', 'third']) {
				await fail(await send(query), timeout())
			}
			expect(screen.snacks()).toHaveLength(1)

			// Nothing waits behind the shown one.
			await screen.pass(SNACK_LONG_MS)
			await screen.pass()
			expect(screen.snacks()).toEqual([])
		})

		it('@spec components/infrastructure/fan/web/route/discovery "Searching again after a failure"', async () => {
			await fail(await send('Vaundy'), timeout())

			await screen.enter()

			expect(screen.requests.map((r) => r.query)).toEqual(['Vaundy', 'Vaundy'])
			expect(screen.loading()).toBe(true)
		})

		it('@spec components/infrastructure/fan/web/route/discovery "Input that keeps a failed query"', async () => {
			await fail(await send('Vaundy'), timeout())

			await send('Vaundy ')

			expect(screen.requests).toHaveLength(1)
		})
	})
})
