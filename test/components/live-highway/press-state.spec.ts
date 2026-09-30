import { I18N } from '@aurelia/i18n'
import { createFixture } from '@aurelia/testing'
import { IEventAggregator, Registration } from 'aurelia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConcertHighway } from '../../../src/components/live-highway/concert-highway'
import { EventCard } from '../../../src/components/live-highway/event-card'
import { BeamVarsCustomAttribute } from '../../../src/custom-attributes/beam-vars'
import type { DateGroup } from '../../../src/entities/concert'
import { makeConcert, makeDateGroup } from '../../helpers/mock-date-groups'
import { createMockI18n } from '../../helpers/mock-i18n'

const deps = [
	ConcertHighway,
	EventCard,
	BeamVarsCustomAttribute,
	Registration.instance(I18N, createMockI18n()),
	Registration.instance(IEventAggregator, {
		publish: vi.fn(),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
	}),
]

function manyGroups(count: number): DateGroup[] {
	return Array.from({ length: count }, (_, i) => {
		const day = String(i + 1).padStart(2, '0')
		return makeDateGroup({
			dateKey: `2026-05-${day}`,
			label: `5月${i + 1}日`,
			home: [makeConcert({ id: `h${i}`, matched: i % 2 === 0 })],
			nearby: [makeConcert({ id: `n${i}` })],
			away: [makeConcert({ id: `a${i}` })],
		})
	})
}

describe('press acknowledgement', () => {
	let stop: (() => unknown) | null = null

	afterEach(async () => {
		await stop?.()
		stop = null
		vi.restoreAllMocks()
	})

	// @spec components/infrastructure/fan/web/global/app-shell "Building a screen does no press-related work"
	it('builds a screen of tappable cards without any per-card press work', async () => {
		const pressListeners: EventTarget[] = []
		const original = EventTarget.prototype.addEventListener
		vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(
			function (this: EventTarget, type, listener, options) {
				if (type === 'pointerdown' || type === 'pointerup') {
					pressListeners.push(this)
				}
				return original.call(this, type, listener, options)
			},
		)
		const styleReads = vi.spyOn(window, 'getComputedStyle')

		const fixture = await createFixture(
			'<concert-highway date-groups.bind="groups" show-beams.bind="false"></concert-highway>',
			class App {
				groups = manyGroups(10)
			},
			deps,
		).started
		stop = () => fixture.stop(true)

		const cards = fixture.appHost.querySelectorAll('[data-live-card]')
		expect(cards.length).toBe(30)
		// No press listener, no style read, and nothing injected into a card.
		expect(pressListeners).toEqual([])
		expect(styleReads).not.toHaveBeenCalled()
		for (const card of cards) {
			expect(card.hasAttribute('data-press-feedback')).toBe(false)
			expect(card.querySelector('.press-ripple-container')).toBeNull()
		}
	})
})
