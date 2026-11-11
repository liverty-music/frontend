import { I18N } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import type { Artist } from '../../src/entities/artist'
import { DiscoverySearchResults } from '../../src/routes/discovery/discovery-search-results'

function artist(id: string, name: string): Artist {
	return { id, name, mbid: '' }
}

describe('Discovery search results', () => {
	// @spec components/infrastructure/fan/web/route/discovery "Search results"
	it('asks to follow an unfollowed row on a tap anywhere on it, and keeps the row busy until the parent settles; a followed row shows ✓ and ignores taps', async () => {
		let settle: () => void = () => {}
		const onFollow = vi.fn((event: CustomEvent) =>
			event.detail.waitUntil(
				new Promise<void>((resolve) => {
					settle = resolve
				}),
			),
		)
		const fixture = await createFixture
			.html(
				`<discovery-search-results search.bind="search" followed-ids.bind="followedIds" follow.trigger="onFollow($event)"></discovery-search-results>`,
			)
			.component(
				class {
					public search = {
						searchResults: [artist('a1', 'Vaundy'), artist('a2', 'YOASOBI')],
					}
					public followedIds = new Set(['a2'])
					public onFollow = onFollow
				},
			)
			.deps(
				DiscoverySearchResults,
				BusyOnClickCustomAttribute,
				Registration.instance(I18N, { tr: (key: string) => key }),
			)
			.build().started
		await tasksSettled()

		const rows = [
			...fixture.appHost.querySelectorAll<HTMLElement>('.result-item'),
		]
		expect(rows.map((r) => r.getAttribute('role'))).toEqual([
			'button',
			'button',
		])

		// A tap on the row's name (not a nested control) follows the artist.
		rows[0].querySelector<HTMLElement>('.result-name')?.click()
		expect(onFollow).toHaveBeenCalledTimes(1)
		expect(onFollow.mock.calls[0][0].detail.artist).toEqual(
			artist('a1', 'Vaundy'),
		)
		expect(rows[0].hasAttribute('data-busy')).toBe(true)
		settle()
		await new Promise((r) => setTimeout(r, 0))
		expect(rows[0].hasAttribute('data-busy')).toBe(false)

		expect(rows[1].getAttribute('aria-disabled')).toBe('true')
		expect(rows[1].getAttribute('data-followed')).toBe('true')

		onFollow.mockClear()
		rows[1].click()
		expect(onFollow).not.toHaveBeenCalled()
	})
})
