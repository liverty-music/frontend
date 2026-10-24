import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { describe, expect, it, vi } from 'vitest'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import type { Artist } from '../../src/entities/artist'
import discoveryTemplate from '../../src/routes/discovery/discovery-route.html?raw'

/**
 * The search results list, taken from the Discovery template so the bindings
 * under test are the ones that ship.
 */
function resultsList(): string {
	const block = discoveryTemplate.match(
		/<ul class="results-list"[\s\S]*?<\/ul>/,
	)?.[0]
	if (!block) throw new Error('discovery results list not found')
	// The check icon is a separate component; a plain marker keeps it visible.
	return block.replace(
		/<svg-icon([^>]*)><\/svg-icon>/,
		'<i$1 data-icon="check"></i>',
	)
}

function artist(id: string, name: string): Artist {
	return { id, name, mbid: '' }
}

describe('Discovery search results', () => {
	// @spec components/infrastructure/fan/web/route/discovery "Search results"
	it('follows an unfollowed row on a tap anywhere on it; a followed row shows ✓ and ignores taps', async () => {
		const onFollowFromSearch = vi.fn(async () => {})
		const fixture = await createFixture
			.html(resultsList())
			.component(
				class {
					public search = {
						searchResults: [artist('a1', 'Vaundy'), artist('a2', 'YOASOBI')],
					}
					public followedIds = new Set(['a2'])
					public onFollowFromSearch = onFollowFromSearch
				},
			)
			.deps(BusyOnClickCustomAttribute)
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
		expect(onFollowFromSearch).toHaveBeenCalledWith(artist('a1', 'Vaundy'))

		expect(rows[0].querySelector('[data-icon="check"]')).toBeNull()
		expect(rows[1].querySelector('[data-icon="check"]')).not.toBeNull()
		expect(rows[1].getAttribute('aria-disabled')).toBe('true')

		onFollowFromSearch.mockClear()
		rows[1].click()
		expect(onFollowFromSearch).not.toHaveBeenCalled()
	})
})
