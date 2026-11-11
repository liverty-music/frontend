import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { describe, expect, it } from 'vitest'
import { ArtistHypeRow } from '../../src/routes/my-artists/artist-hype-row'
import { HypeDotRadio } from '../../src/routes/my-artists/hype-dot-radio'

type Level = 'watch' | 'home' | 'nearby' | 'away'
const LEVELS: Level[] = ['watch', 'home', 'nearby', 'away']

/**
 * One artist's row in a table, with a page that answers the row's
 * `hype-changed` event as `answer` says: it keeps the pick, puts the previous
 * level back at once, or puts it back later (a failed save).
 */
async function render(answer: 'keep' | 'revert-now' | 'revert-later') {
	const artist = { artist: { id: 'a1', name: 'Band' }, hype: 'home' as Level }
	const page = {
		artist,
		onHype: (detail: { artist: typeof artist; level: Level }) => {
			const previous = artist.hype
			artist.hype = detail.level
			if (answer === 'revert-now') artist.hype = previous
			if (answer === 'revert-later') {
				setTimeout(() => {
					artist.hype = previous
				}, 0)
			}
		},
	}
	const fixture = await createFixture
		.html(
			`<table><tbody><tr as-element="artist-hype-row" artist.bind="artist" editing.bind="false" hype-changed.trigger="onHype($event.detail)"></tr></tbody></table>`,
		)
		.component(page)
		.deps(ArtistHypeRow, HypeDotRadio)
		.build().started
	await tasksSettled()
	const radios = [
		...fixture.appHost.querySelectorAll<HTMLInputElement>(
			'input[type="radio"]',
		),
	]
	/** The levels whose radio is checked. */
	const checked = () => radios.flatMap((r, i) => (r.checked ? [LEVELS[i]] : []))
	return { fixture, radios, checked }
}

describe('artist hype row radios', () => {
	// The radio side of "Native radio input semantics"; the whole scenario is
	// checked in the My Artists route story.
	it('checks exactly the radio of the artist’s current level from the first display on', async () => {
		const { fixture, radios, checked } = await render('keep')

		expect(radios).toHaveLength(4)
		expect(radios.every((r) => r.name === 'hype-a1')).toBe(true)
		expect(checked()).toEqual(['home'])
		await fixture.stop(true)
	})

	it('checks the tapped radio when the page keeps the pick', async () => {
		const { fixture, radios, checked } = await render('keep')

		radios[2].click()
		await tasksSettled()

		expect(checked()).toEqual(['nearby'])
		await fixture.stop(true)
	})

	// The radio side of "Parent reverts hype selection"; the whole scenario is
	// checked in the My Artists route story.
	it('checks the previous level’s radio again when the page puts it back at once', async () => {
		const { fixture, radios, checked } = await render('revert-now')

		radios[3].click()
		await tasksSettled()

		expect(checked()).toEqual(['home'])
		expect(radios[3].checked).toBe(false)
		await fixture.stop(true)
	})

	it('checks the previous level’s radio again when the page puts it back later', async () => {
		const { fixture, radios, checked } = await render('revert-later')

		radios[3].click()
		await new Promise((r) => setTimeout(r, 10))
		await tasksSettled()

		expect(checked()).toEqual(['home'])
		expect(radios[3].checked).toBe(false)
		await fixture.stop(true)
	})
})
