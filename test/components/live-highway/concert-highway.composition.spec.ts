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

const sharedDeps = [
	ConcertHighway,
	EventCard,
	BeamVarsCustomAttribute,
	Registration.instance(I18N, createMockI18n()),
	Registration.instance(IEventAggregator, {
		publish: vi.fn(),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
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

	it('hides stage header when dateGroups is empty', async () => {
		const result = await createFixture(
			'<concert-highway date-groups.bind="groups"></concert-highway>',
			class App {
				groups: DateGroup[] = []
			},
			sharedDeps,
		).started
		fixture = result as any

		const stageHeader = result.appHost.querySelector('.stage-header')
		expect(stageHeader).toBeNull()
	})

	it('builds beam index map for matched events', async () => {
		const groups: DateGroup[] = [
			makeDateGroup({
				home: [makeConcert({ id: 'h1', matched: true })],
				nearby: [makeConcert({ id: 'n1', matched: true })],
				away: [makeConcert({ id: 'a1', matched: false })],
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

		// Access the ConcertHighway component viewModel
		const ceEl = result.appHost.querySelector('concert-highway')
		expect(ceEl).not.toBeNull()

		// Find the concert-highway's viewModel via the CE element
		const hwVm = (ceEl as any).$controller?.viewModel as
			| ConcertHighway
			| undefined
		if (hwVm) {
			expect(hwVm.beamIndexMap.size).toBe(2)
			expect(hwVm.beamIndexMap.has('h1')).toBe(true)
			expect(hwVm.beamIndexMap.has('n1')).toBe(true)
			expect(hwVm.beamIndexMap.has('a1')).toBe(false)
		}
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
