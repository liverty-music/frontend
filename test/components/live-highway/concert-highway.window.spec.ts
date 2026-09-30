import { I18N } from '@aurelia/i18n'
import { createFixture } from '@aurelia/testing'
import { IEventAggregator, Registration, runTasks } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConcertHighway } from '../../../src/components/live-highway/concert-highway'
import { EventCard } from '../../../src/components/live-highway/event-card'
import { BeamVarsCustomAttribute } from '../../../src/custom-attributes/beam-vars'
import type { DateGroup, TimetableAnchor } from '../../../src/entities/concert'
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

/**
 * Stand-in for the browser's IntersectionObserver: jsdom has no layout, so the
 * test decides when an edge marker comes into reach.
 */
class FakeObserver {
	static current: FakeObserver | null = null
	readonly targets = new Set<Element>()
	observed = 0
	constructor(
		private readonly callback: IntersectionObserverCallback,
		readonly options: IntersectionObserverInit,
	) {
		FakeObserver.current = this
	}
	observe(target: Element) {
		this.targets.add(target)
		this.observed += 1
	}
	unobserve(target: Element) {
		this.targets.delete(target)
	}
	disconnect() {
		this.targets.clear()
	}
	/** Report the observed marker matching `selector` as in reach. */
	reach(selector: string) {
		const target = [...this.targets].find((t) => t.matches(selector))
		if (!target) throw new Error(`${selector} is not observed`)
		this.callback(
			[{ target, isIntersecting: true } as IntersectionObserverEntry],
			this as unknown as IntersectionObserver,
		)
		runTasks()
	}
}

/** `count` consecutive dates from 2026-01-01, one concert per lane each. */
function dates(count: number): DateGroup[] {
	return Array.from({ length: count }, (_, i) => {
		const d = new Date(Date.UTC(2026, 0, 1 + i))
		const key = d.toISOString().slice(0, 10)
		return makeDateGroup({
			dateKey: key,
			label: key,
			home: [makeConcert({ id: `h${i}`, matched: i % 3 === 0 })],
			nearby: [makeConcert({ id: `n${i}` })],
			away: [makeConcert({ id: `a${i}` })],
		})
	})
}

function builtKeys(host: Element): string[] {
	return [
		...host.querySelectorAll<HTMLElement>('.date-group[data-date-key]'),
	].map((g) => g.dataset.dateKey ?? '')
}

describe('ConcertHighway date window', () => {
	let stop: (() => unknown) | null = null

	beforeEach(() => {
		FakeObserver.current = null
		vi.stubGlobal('IntersectionObserver', FakeObserver)
		// jsdom implements neither; the restore path calls it.
		Element.prototype.scrollIntoView = vi.fn()
	})

	afterEach(async () => {
		await stop?.()
		stop = null
		vi.unstubAllGlobals()
	})

	async function mount(
		groups: DateGroup[],
		anchor: TimetableAnchor | null = null,
	) {
		const fixture = await createFixture(
			'<concert-highway date-groups.bind="groups" initial-anchor.bind="anchor"></concert-highway>',
			class App {
				groups = groups
				anchor = anchor
			},
			deps,
		).started
		stop = () => fixture.stop(true)
		return fixture
	}

	// @spec components/infrastructure/fan/web/route/dashboard "Only the window is built"
	// @spec components/infrastructure/fan/web/route/dashboard "Off-screen timetable content is not styled or laid out eagerly"
	it('builds only a window of the loaded dates, whatever their number', async () => {
		for (const count of [30, 225]) {
			const groups = dates(count)
			const { appHost } = await mount(groups)
			const keys = builtKeys(appHost)
			expect(keys.length).toBeLessThanOrEqual(24)
			expect(keys.length).toBe(12)
			expect(keys[0]).toBe('2026-01-01')
			// A date outside the window is not in the document at all, so it can
			// contribute no style, layout or paint work.
			expect(appHost.querySelectorAll('[data-live-card]').length).toBe(12 * 3)
			expect(keys).not.toContain(groups[12].dateKey)
			await stop?.()
			stop = null
		}
	})

	// @spec components/infrastructure/fan/web/global/live-highway "Beams do not defeat viewport-scoped rendering"
	it('lights only concerts of built dates, and never builds a date to light it', async () => {
		const groups = dates(225)
		const { appHost } = await mount(groups)
		const built = builtKeys(appHost)
		expect(built).toHaveLength(12)

		// Matched concerts exist throughout the 225 dates, but only those of
		// built dates have a beam; the rest have neither a card nor a beam.
		const beams = [...appHost.querySelectorAll<HTMLElement>('.laser-beam')].map(
			(b) => b.dataset.beamTimeline,
		)
		const expected = groups
			.filter((g) => built.includes(g.dateKey))
			.flatMap((g) => g.home.filter((c) => c.matched))
			.map((c) => `--beam-${c.id}`)
		expect(beams).toEqual(expected)
		const farMatched = groups[99].home[0]
		expect(farMatched.matched).toBe(true)
		expect(beams).not.toContain(`--beam-${farMatched.id}`)
		// Turning beams on built nothing more.
		expect(builtKeys(appHost)).toEqual(built)
	})

	it('opens the window around the remembered date, deep in the list', async () => {
		const groups = dates(225)
		const anchor = { dateKey: groups[200].dateKey, offset: 0 }
		const { appHost } = await mount(groups, anchor)

		const keys = builtKeys(appHost)
		expect(keys.length).toBeLessThanOrEqual(24)
		expect(keys).toContain(anchor.dateKey)
		// Two dates of context above the one the fan left on.
		expect(keys[0]).toBe(groups[198].dateKey)
	})

	it('opens at the nearest later date when the remembered one is gone', async () => {
		const groups = dates(225).filter((_, i) => i !== 100)
		const gone = dates(225)[100].dateKey
		const { appHost } = await mount(groups, { dateKey: gone, offset: 40 })

		expect(builtKeys(appHost)).toContain(dates(225)[101].dateKey)
		expect(builtKeys(appHost)).not.toContain(gone)
	})

	// @spec components/infrastructure/fan/web/route/dashboard "Scrolling down reaches every later date"
	it('adds later dates as the bottom edge comes into reach, up to the last', async () => {
		const groups = dates(60)
		const { appHost } = await mount(groups)
		const observer = FakeObserver.current
		if (!observer) throw new Error('no edge observer')
		// Ahead of the fan, not at the edge: reach is widened past the viewport.
		expect(observer.options.rootMargin).toMatch(/^\d+%/)

		let steps = 0
		while (!builtKeys(appHost).includes(groups[59].dateKey)) {
			observer.reach('.window-edge:last-child')
			steps += 1
			expect(steps).toBeLessThan(10)
		}
		// Each step is bounded, never the whole list at once.
		expect(steps).toBe(4)
		expect(builtKeys(appHost)).toEqual(groups.map((g) => g.dateKey))
	})

	it('adds earlier dates above as the top edge comes into reach', async () => {
		const groups = dates(60)
		const { appHost } = await mount(groups, {
			dateKey: groups[40].dateKey,
			offset: 0,
		})
		const observer = FakeObserver.current
		if (!observer) throw new Error('no edge observer')
		expect(builtKeys(appHost)[0]).toBe(groups[38].dateKey)

		observer.reach('.window-edge:first-child')
		expect(builtKeys(appHost)[0]).toBe(groups[26].dateKey)
		// Everything already built stays built.
		expect(builtKeys(appHost)).toContain(groups[40].dateKey)
	})

	it('keeps the built span when the list is replaced', async () => {
		const groups = dates(60)
		const fixture = await mount(groups, {
			dateKey: groups[30].dateKey,
			offset: 0,
		})
		const before = builtKeys(fixture.appHost)

		// A background refresh: new objects, same dates, one date dropped.
		;(fixture.component as { groups: DateGroup[] }).groups = dates(60).filter(
			(_, i) => i !== 31,
		)
		runTasks()

		const after = builtKeys(fixture.appHost)
		expect(after[0]).toBe(before[0])
		expect(after).not.toContain(groups[31].dateKey)
		expect(after).toContain(groups[30].dateKey)
	})

	it('reopens a full window when every built date leaves the list', async () => {
		const groups = dates(60)
		const fixture = await mount(groups, {
			dateKey: groups[40].dateKey,
			offset: 0,
		})
		expect(builtKeys(fixture.appHost)[0]).toBe(groups[38].dateKey)

		// A filter keeps only dates before anything that was built.
		const earlier = dates(60).slice(0, 20)
		;(fixture.component as { groups: DateGroup[] }).groups = earlier
		runTasks()

		// Not collapsed to one date: a full window over what remains.
		expect(builtKeys(fixture.appHost)).toHaveLength(12)
		expect(builtKeys(fixture.appHost).at(-1)).toBe(earlier[19].dateKey)
	})

	it('reports its edges afresh when the list is replaced', async () => {
		const groups = dates(60)
		const fixture = await mount(groups, {
			dateKey: groups[30].dateKey,
			offset: 0,
		})
		const observer = FakeObserver.current
		if (!observer) throw new Error('no edge observer')
		const before = observer.observed

		// An edge already in reach stays in reach across the replacement, so the
		// observer would never report it again unless it is observed afresh.
		;(fixture.component as { groups: DateGroup[] }).groups = dates(60)
		runTasks()

		expect(observer.observed).toBe(before + 2)
		expect(observer.targets.size).toBe(2)
	})

	it('releases its observer when detached', async () => {
		await mount(dates(30))
		const observer = FakeObserver.current
		expect(observer?.targets.size).toBe(2)
		await stop?.()
		stop = null
		expect(observer?.targets.size).toBe(0)
	})
})
