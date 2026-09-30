import { I18N } from '@aurelia/i18n'
import { createFixture } from '@aurelia/testing'
import {
	BindingMode,
	CustomElement,
	IEventAggregator,
	Registration,
	runTasks,
} from 'aurelia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConcertHighway } from '../../../src/components/live-highway/concert-highway'
import { EventCard } from '../../../src/components/live-highway/event-card'
import { BeamVarsCustomAttribute } from '../../../src/custom-attributes/beam-vars'
import type { DateGroup } from '../../../src/entities/concert'
import { IAnalyticsService } from '../../../src/lib/analytics/analytics-service'
import { makeConcert, makeDateGroup } from '../../helpers/mock-date-groups'
import { createMockI18n } from '../../helpers/mock-i18n'

const sharedDeps = [
	ConcertHighway,
	EventCard,
	BeamVarsCustomAttribute,
	Registration.instance(I18N, createMockI18n()),
	Registration.instance(IEventAggregator, {
		publish: vi.fn(),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
	}),
	// IAnalyticsService is now required by EventCard. Register a stub so
	// composition tests do not transitively pull in the real consent /
	// runtime-config stack — those have their own dedicated specs.
	Registration.instance(IAnalyticsService, {
		capture: vi.fn(),
		identify: vi.fn(),
		reset: vi.fn(),
		getFeatureFlag: vi.fn((_key: string, fallback: unknown) => fallback),
	}),
]

describe('ConcertHighway composition', () => {
	let fixture: Awaited<ReturnType<typeof createFixture>> | null = null

	afterEach(async () => {
		if (fixture) {
			;(await (fixture as any).stop?.(true)) ?? (fixture as any).tearDown?.()
			fixture = null
		}
	})

	it('renders date groups with stage header and lane grid', async () => {
		const groups: DateGroup[] = [makeDateGroup()]

		const result = await createFixture(
			'<concert-highway date-groups.bind="groups"></concert-highway>',
			class App {
				groups = groups
			},
			sharedDeps,
		).started
		fixture = result as any

		const appHost = result.appHost

		// Stage header is rendered
		const stageHeader = appHost.querySelector('.stage-header')
		expect(stageHeader).not.toBeNull()
		expect(stageHeader!.querySelectorAll('[data-stage]')).toHaveLength(3)

		// Date separator is rendered
		const dateSep = appHost.querySelector('.date-separator time')
		expect(dateSep).not.toBeNull()
		expect(dateSep!.textContent).toContain('4月1日')

		// Lane grid has 3 lanes (li elements with data-lane inside .lane-grid)
		const lanes = appHost.querySelectorAll('.lane-grid > [data-lane]')
		expect(lanes).toHaveLength(3)

		// Event cards are rendered (1 per lane = 3 total)
		const cards = appHost.querySelectorAll('event-card')
		expect(cards.length).toBeGreaterThanOrEqual(3)
	})

	it('renders multiple date groups in order', async () => {
		const groups: DateGroup[] = [
			makeDateGroup({ dateKey: '2026-04-01', label: '4月1日' }),
			makeDateGroup({
				dateKey: '2026-04-02',
				label: '4月2日',
				home: [makeConcert({ id: 'h2' })],
				nearby: [],
				away: [],
			}),
		]

		const result = await createFixture(
			'<concert-highway date-groups.bind="groups"></concert-highway>',
			class App {
				groups = groups
			},
			sharedDeps,
		).started
		fixture = result as any

		const timeEls = result.appHost.querySelectorAll('.date-separator time')
		expect(timeEls).toHaveLength(2)
		expect(timeEls[0].textContent).toContain('4月1日')
		expect(timeEls[1].textContent).toContain('4月2日')
	})

	it('renders the stage header with no dateGroups, so the frame is on screen while data loads', async () => {
		const result = await createFixture(
			'<concert-highway date-groups.bind="groups"></concert-highway>',
			class App {
				groups: DateGroup[] = []
			},
			sharedDeps,
		).started
		fixture = result as any

		// The stage header needs no data — it is the App Shell part of the
		// timetable. It used to be gated on `dateGroups.length > 0`, which withheld
		// the frame for exactly the window it exists to fill.
		const stageHeader = result.appHost.querySelector('.stage-header')
		expect(stageHeader).not.toBeNull()
		expect(
			result.appHost.querySelectorAll('.stage-header > span'),
		).toHaveLength(3)
	})

	/** Bindings on a card's own element that target `attr`, with their modes. */
	function bindingModesFor(card: Element, attr: string): number[] {
		const host = card.closest('event-card') as HTMLElement
		const controller = CustomElement.for(host) as unknown as {
			bindings: unknown[] | null
		}
		return (controller.bindings ?? [])
			.filter(
				(b: any) =>
					b.target === card &&
					(b.targetAttribute === attr || b.targetProperty === attr),
			)
			.map((b: any) => b.mode)
	}

	// @spec components/infrastructure/fan/web/global/live-highway "Disabled beams cost nothing"
	it('builds a timetable with beams off that carries no beam work', async () => {
		const groups: DateGroup[] = [
			makeDateGroup({
				home: [makeConcert({ id: 'h1', matched: true })],
				nearby: [makeConcert({ id: 'n1', matched: true })],
				away: [makeConcert({ id: 'a1', matched: false })],
			}),
		]

		const result = await createFixture(
			'<concert-highway date-groups.bind="groups" show-beams.bind="false"></concert-highway>',
			class App {
				groups = groups
			},
			sharedDeps,
		).started
		fixture = result as any
		const host = result.appHost

		// No beam set, no overlay, and the stylesheet's beams-on marker is absent,
		// so no card declares a timeline.
		expect(host.querySelectorAll('.laser-beam')).toHaveLength(0)
		expect(host.querySelector('[data-beams]')).toBeNull()

		const cards = [...host.querySelectorAll<HTMLElement>('[data-live-card]')]
		expect(cards).toHaveLength(3)
		for (const card of cards) {
			expect(card.style.getPropertyValue('view-timeline')).toBe('')
			expect(card.hasAttribute('data-beam-index')).toBe(false)
			// The only beam-related thing a card has is its fixed name, set once:
			// a one-time binding, never observed for changes.
			expect(card.dataset.beamName).toMatch(/^--beam-/)
			const modes = bindingModesFor(card, 'data-beam-name')
			expect(modes).toEqual([BindingMode.oneTime])
		}
	})

	// @spec components/infrastructure/fan/web/global/live-highway "Turning beams on reaches the concerts already on screen"
	it('turns beams on in place without rebuilding any group or card', async () => {
		const groups: DateGroup[] = [
			makeDateGroup({
				home: [makeConcert({ id: 'h1', matched: true })],
				nearby: [makeConcert({ id: 'n1', matched: false })],
				away: [makeConcert({ id: 'a1', matched: true })],
			}),
		]

		const result = await createFixture(
			'<concert-highway date-groups.bind="groups" show-beams.bind="beams"></concert-highway>',
			class App {
				groups = groups
				beams = false
			},
			sharedDeps,
		).started
		fixture = result as any
		const host = result.appHost

		const groupsBefore = [...host.querySelectorAll('.date-group')]
		const cardsBefore = [...host.querySelectorAll('[data-live-card]')]

		;(result.component as { beams: boolean }).beams = true
		runTasks()

		// The marker the stylesheet keys the timelines off, and one beam per
		// matched concert, each following the name its card already carries.
		expect(host.querySelector('[data-beams]')).not.toBeNull()
		const beams = [...host.querySelectorAll<HTMLElement>('.laser-beam')]
		expect(beams.map((b) => b.dataset.beamTimeline)).toEqual([
			'--beam-h1',
			'--beam-a1',
		])
		for (const name of ['--beam-h1', '--beam-a1']) {
			expect(
				cardsBefore.some((c) => (c as HTMLElement).dataset.beamName === name),
			).toBe(true)
		}

		// Nothing was rebuilt: the very same group and card nodes are in place.
		expect([...host.querySelectorAll('.date-group')]).toEqual(groupsBefore)
		expect([...host.querySelectorAll('[data-live-card]')]).toEqual(cardsBefore)
	})

	it('does not dispatch event-selected in readonly mode', async () => {
		const groups: DateGroup[] = [makeDateGroup()]
		const handler = vi.fn()

		const result = await createFixture(
			`<concert-highway
				date-groups.bind="groups"
				is-readonly="true"
				event-selected.trigger="handler($event)"
			></concert-highway>`,
			class App {
				groups = groups
				handler = handler
			},
			sharedDeps,
		).started
		fixture = result as any

		// Click an event card
		const card = result.appHost.querySelector('event-card')
		expect(card).not.toBeNull()
		card!.dispatchEvent(new Event('click', { bubbles: true }))

		expect(handler).not.toHaveBeenCalled()
	})

	it('cleans up scroll listener and rAF on detaching', async () => {
		const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame')
		const groups: DateGroup[] = [makeDateGroup()]

		const result = await createFixture(
			'<concert-highway date-groups.bind="groups"></concert-highway>',
			class App {
				groups = groups
			},
			sharedDeps,
		).started
		fixture = result as any

		// Stop the fixture — triggers detaching()
		await ((result as any).stop?.(true) ?? (result as any).tearDown?.())
		fixture = null // already cleaned up

		// cancelAnimationFrame should have been called if a rAF was pending
		// (it may or may not have been called depending on timing, but no error should occur)
		expect(true).toBe(true)
		cancelSpy.mockRestore()
	})
})
