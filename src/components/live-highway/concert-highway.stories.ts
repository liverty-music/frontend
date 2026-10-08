import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement } from 'aurelia'
import { expect } from 'storybook/test'
import { artistHue } from '../../adapter/view/artist-color'
import { BeamVarsCustomAttribute } from '../../custom-attributes/beam-vars'
import type { Concert, DateGroup, LaneType } from '../../entities/concert'
import { ConcertHighway } from './concert-highway'
import { EventCard } from './event-card'

let seq = 0
function ev(
	artistName: string,
	lane: LaneType,
	matched: boolean,
	date: string,
): Concert {
	seq += 1
	return {
		id: `ev-${seq}`,
		artistName,
		artistId: `artist-${seq}`,
		venueName: 'Zepp DiverCity',
		locationLabel: '東京',
		date: new Date(date),
		startTime: '19:00',
		title: `${artistName} Live`,
		sourceUrl: 'https://example.com',
		isFirstParty: false,
		hypeLevel: lane === 'home' ? 'home' : lane === 'nearby' ? 'nearby' : 'away',
		matched,
		artistHue: artistHue(artistName),
	}
}

/**
 * Two date groups with matched cards across lanes. Multiple groups are required
 * because the sticky date separators only matter across a multi-group scroll,
 * and laser beams are generated one-per-matched-card.
 */
const DATE_GROUPS: DateGroup[] = [
	{
		label: '7月15日 (水)',
		dateKey: '2026-07-15',
		isFirstOfMonth: true,
		monthSeparatorLabel: '2026年7月',
		home: [ev('VAUNDY', 'home', true, '2026-07-15T19:00:00+09:00')],
		nearby: [
			ev('Mrs. GREEN APPLE', 'nearby', true, '2026-07-15T19:00:00+09:00'),
		],
		away: [ev('YOASOBI', 'away', false, '2026-07-15T19:00:00+09:00')],
	},
	{
		label: '7月18日 (土)',
		dateKey: '2026-07-18',
		isFirstOfMonth: false,
		monthSeparatorLabel: '',
		home: [ev('Aimer', 'home', true, '2026-07-18T18:00:00+09:00')],
		nearby: [],
		away: [ev('King Gnu', 'away', false, '2026-07-18T18:00:00+09:00')],
	},
]

/**
 * Enough date groups to push most of them out of the viewport — the condition the
 * off-screen beam guard needs, and the one a two-group fixture cannot create.
 */
const MANY_GROUPS: DateGroup[] = Array.from({ length: 20 }, (_, i) => {
	const day = 1 + i
	const date = `2026-08-${String(day).padStart(2, '0')}`
	return {
		label: `8月${day}日`,
		dateKey: date,
		isFirstOfMonth: i === 0,
		monthSeparatorLabel: i === 0 ? '2026年8月' : '',
		home: [ev('VAUNDY', 'home', true, `${date}T19:00:00+09:00`)],
		nearby: [ev('Aimer', 'nearby', true, `${date}T19:00:00+09:00`)],
		away: [ev('King Gnu', 'away', false, `${date}T19:00:00+09:00`)],
	}
})

/**
 * Groups of deliberately uneven height. Height is what the defect turned on: a
 * saved pixel offset only misses if the groups it counts past are not all the
 * size the browser guessed, so a list of identical groups would pass a broken
 * implementation.
 */
const UNEVEN_GROUPS: DateGroup[] = Array.from({ length: 30 }, (_, i) => {
	const day = 1 + i
	const date = `2026-09-${String(day).padStart(2, '0')}`
	const count = 1 + (i % 4)
	return {
		label: `9月${day}日`,
		dateKey: date,
		isFirstOfMonth: i === 0,
		monthSeparatorLabel: i === 0 ? '2026年9月' : '',
		home: Array.from({ length: count }, () =>
			ev('VAUNDY', 'home', true, `${date}T19:00:00+09:00`),
		),
		nearby: [],
		away: Array.from({ length: 1 + ((i + 2) % 3) }, () =>
			ev('King Gnu', 'away', false, `${date}T19:00:00+09:00`),
		),
	}
})

// Matched cards across both groups → expected laser-beam count.
const MATCHED_COUNT = DATE_GROUPS.flatMap((g) => [
	...g.home,
	...g.nearby,
	...g.away,
]).filter((e) => e.matched).length

/** The card a beam follows, matched by value rather than built into a selector. */
function cardFor(root: HTMLElement, timeline: string): HTMLElement | undefined {
	return [...root.querySelectorAll<HTMLElement>('[data-live-card]')].find(
		(card) => card.dataset.beamName === timeline,
	)
}

function highwayStory(dateGroups: DateGroup[], hideAway = false) {
	return defineAureliaStory({
		// A sized grid host so the highway (block-size: 100%) lays out its lanes.
		template: `
			<div style="block-size: 560px; display: grid;">
				<concert-highway date-groups.bind="dateGroups" show-beams.bind="true" readonly.bind="true" hide-away.bind="hideAway"></concert-highway>
			</div>
		`,
		props: { dateGroups, hideAway },
		register: [ConcertHighway, EventCard, BeamVarsCustomAttribute],
	})
}

/**
 * The layout contract the timetable rests on: every date group's lanes line up
 * with the stage header's columns. The lanes used to inherit those columns by
 * chaining `subgrid` from the root; each group now declares them itself so it
 * can carry containment, and this asserts the two definitions have not drifted.
 *
 * Checks a deep group as well as the first, because a drift that only shows up
 * after the initially-rendered rows is exactly what a viewport-scoped render
 * would hide.
 */
async function assertLanesAlignWithStageHeader(
	canvasElement: HTMLElement,
	expectedLanes: number,
) {
	const headers = [
		...canvasElement.querySelectorAll<HTMLElement>('.stage-header > span'),
	]
	await expect(headers.length).toBe(expectedLanes)

	const groups = [
		...canvasElement.querySelectorAll<HTMLElement>(
			'.concert-scroll > .date-group',
		),
	]
	const probes = [groups[0], groups[groups.length - 1]].filter(Boolean)

	for (const group of probes) {
		const lanes = [...group.querySelectorAll<HTMLElement>('.lane')]
		await expect(lanes.length).toBe(expectedLanes)

		for (const [i, lane] of lanes.entries()) {
			const head = headers[i].getBoundingClientRect()
			const box = lane.getBoundingClientRect()
			// Sub-pixel tolerance: fractional column widths never land exactly.
			await expect(Math.abs(box.left - head.left)).toBeLessThan(0.5)
			await expect(Math.abs(box.width - head.width)).toBeLessThan(0.5)

			// A card must never spill past its lane — the visible symptom when the
			// column definition breaks.
			const card = lane.querySelector<HTMLElement>('.event-card')
			if (card) {
				await expect(card.getBoundingClientRect().width).toBeLessThanOrEqual(
					box.width,
				)
			}
		}
	}
}

const meta = {
	title: 'LiveHighway/ConcertHighway',
	component: ConcertHighway,
	tags: ['test', 'autodocs'],
} satisfies Meta<typeof ConcertHighway>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The three-lane timetable. Guards its layout contract: lanes line up with the
 * stage header, the date separators stay `position: sticky`, and one laser beam
 * renders per matched card of a built date.
 */
export const PopulatedTimetable = {
	render: () => highwayStory(DATE_GROUPS),
	play: async ({ canvasElement }) => {
		const groups = canvasElement.querySelectorAll<HTMLElement>(
			'.concert-scroll > .date-group',
		)
		// A short list fits in the window, so every date is built.
		await expect(groups.length).toBe(DATE_GROUPS.length)

		await assertLanesAlignWithStageHeader(canvasElement, 3)

		// @spec components/infrastructure/fan/web/route/dashboard "Viewport-scoping off-screen content does not regress sticky headers or shift layout"
		// Sticky date separators, alongside the lane alignment asserted above.
		const separator =
			canvasElement.querySelector<HTMLElement>('.date-separator')
		if (!separator) throw new Error('date-separator not rendered')
		await expect(getComputedStyle(separator).position).toBe('sticky')

		// Every card carries its artist's hue as a number: the colour identity
		// the card's gradients are drawn from.
		for (const card of canvasElement.querySelectorAll<HTMLElement>(
			'.event-card',
		)) {
			const hue = card.style.getPropertyValue('--artist-hue').trim()
			await expect(Number.isFinite(Number.parseFloat(hue))).toBe(true)
		}

		// One laser beam per matched card of a built date.
		const beams = canvasElement.querySelectorAll('.laser-beam')
		await expect(beams.length).toBe(MATCHED_COUNT)
	},
} satisfies Story

/** A long timetable: 225 dates, the size of the reference account. */
const LONG_GROUPS: DateGroup[] = Array.from({ length: 225 }, (_, i) => {
	const d = new Date(Date.UTC(2026, 0, 1 + i))
	const date = d.toISOString().slice(0, 10)
	return {
		label: date,
		dateKey: date,
		isFirstOfMonth: d.getUTCDate() === 1,
		monthSeparatorLabel: '',
		home: [ev('VAUNDY', 'home', i % 5 === 0, `${date}T19:00:00+09:00`)],
		nearby: [ev('Aimer', 'nearby', false, `${date}T19:00:00+09:00`)],
		away: [],
	}
})

/**
 * The render-cost guard. It used to assert `content-visibility` on every date
 * group — which skipped style and layout for off-screen dates but still built
 * all of them. What bounds the cost now is the date window: of 225 loaded dates
 * only a window is built, and nothing is left for containment to skip.
 */
export const WindowedLongTimetable = {
	render: () => highwayStory(LONG_GROUPS),
	play: async ({ canvasElement }) => {
		const groups = [
			...canvasElement.querySelectorAll<HTMLElement>(
				'.concert-scroll > .date-group',
			),
		]
		await expect(groups.length).toBeGreaterThan(0)
		await expect(groups.length).toBeLessThanOrEqual(24)
		await expect(groups[0].dataset.dateKey).toBe(LONG_GROUPS[0].dateKey)

		for (const group of groups) {
			await expect(getComputedStyle(group).contentVisibility).not.toBe('auto')
		}

		// Beams exist only for matched concerts of built dates.
		const built = new Set(groups.map((g) => g.dataset.dateKey))
		const expected = LONG_GROUPS.filter((g) => built.has(g.dateKey)).flatMap(
			(g) => g.home.filter((e) => e.matched),
		).length
		await expect(canvasElement.querySelectorAll('.laser-beam').length).toBe(
			expected,
		)

		await assertLanesAlignWithStageHeader(canvasElement, 3)
	},
} satisfies Story

/**
 * Motion follows the fan's system preference. The story runs twice: in the
 * `storybook` project, where motion is allowed, and in the
 * `storybook-reduced-motion` project, whose browser requests reduced motion. It
 * reads the preference from the browser and asserts the matching presentation,
 * so the same story is valid in either context.
 *
 * Under Vitest each project also names the preference it emulates in the
 * `reducedMotion` global. The story first checks that the browser reports that
 * preference, so a project whose emulation silently stops working fails here
 * instead of passing both runs on the same branch.
 */
export const MotionFollowsSystemPreference = {
	tags: ['reduced-motion'],
	render: () => highwayStory(DATE_GROUPS),
	play: async ({ canvasElement, globals }) => {
		// @spec components/infrastructure/fan/web/route/dashboard "Reduced motion is respected"
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		if (import.meta.env.MODE === 'test') {
			await expect(typeof globals.reducedMotion).toBe('boolean')
			await expect(reduce).toBe(globals.reducedMotion)
		}

		const cards = [
			...canvasElement.querySelectorAll<HTMLElement>('.event-card'),
		]
		await expect(cards.length).toBeGreaterThan(0)
		for (const card of cards) {
			// The press feedback is the card's only motion.
			await expect(getComputedStyle(card).transitionProperty).toBe(
				reduce ? 'none' : 'transform',
			)
		}

		const beams = [
			...canvasElement.querySelectorAll<HTMLElement>('.laser-beam'),
		]
		await expect(beams.length).toBe(MATCHED_COUNT)
		for (const beam of beams) {
			await expect(getComputedStyle(beam).animationName).toBe(
				reduce ? 'none' : 'beam-length',
			)
		}
	},
} satisfies Story

/**
 * Many groups in a short viewport. Dates outside the window are not built at
 * all, so there is nothing of theirs to style or lay out: the window's own
 * dates are in the document and rendered, and the dates past it are absent
 * until the fan scrolls toward them.
 */
export const OffScreenDatesNotBuilt = {
	render: () => highwayStory(MANY_GROUPS),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/route/dashboard "Off-screen timetable content is not styled or laid out eagerly"
		const scroll = canvasElement.querySelector<HTMLElement>('.concert-scroll')
		if (!scroll) throw new Error('concert-scroll not rendered')

		const built = [
			...scroll.querySelectorAll<HTMLElement>(':scope > .date-group'),
		]
		// The story only proves anything if the list is longer than the window.
		await expect(MANY_GROUPS.length).toBeGreaterThan(built.length)
		await expect(built.length).toBeGreaterThan(0)

		const first = built[0].querySelector<HTMLElement>('.event-card')
		if (!first) throw new Error('event-card not rendered')
		await expect(first.checkVisibility()).toBe(true)

		// The last loaded date has no element at all, so it cannot contribute
		// style, layout or paint work.
		const last = MANY_GROUPS[MANY_GROUPS.length - 1].dateKey
		await expect(built.map((g) => g.dataset.dateKey)).not.toContain(last)
	},
} satisfies Story

/**
 * All Nearby collapses the AWAY column to zero width, so the highway reads as
 * two lanes. The away header span and away lane leave the DOM while the named
 * grid areas stay intact. Storied separately because the flattened date group
 * repeats the root's column definition — if the two ever diverge, the two-lane
 * mode is where it shows first.
 */
export const HideAwayTwoLane = {
	render: () => highwayStory(DATE_GROUPS, true),
	play: async ({ canvasElement }) => {
		await assertLanesAlignWithStageHeader(canvasElement, 2)

		const away = canvasElement.querySelector('[data-lane="away"]')
		await expect(away).toBeNull()
	},
} satisfies Story

/**
 * Beams on. They are driven entirely by each anchor concert's view timeline, so
 * this asserts the wiring the CSS depends on: a scoped timeline name per beam on
 * the host, a matching `view-timeline` on the card — declared by the stylesheet
 * from the name the card carries — and `animation-timeline` on the beam. It deliberately does not assert beam geometry — that is now the
 * browser's job, and there is no script left to verify.
 */
export const BeamsEnabled = {
	render: () => highwayStory(DATE_GROUPS),
	play: async ({ canvasElement }) => {
		const beams = [
			...canvasElement.querySelectorAll<HTMLElement>('.laser-beam'),
		]
		await expect(beams.length).toBe(MATCHED_COUNT)

		const host = canvasElement.querySelector<HTMLElement>('concert-highway')
		if (!host) throw new Error('concert-highway not rendered')
		const scope = getComputedStyle(host).timelineScope

		for (const beam of beams) {
			const name = beam.dataset.beamTimeline ?? ''

			// The beam is not a descendant of its card, so the name must be scoped
			// on a common ancestor or the timeline silently fails to resolve.
			await expect(scope).toContain(name)
			await expect(getComputedStyle(beam).animationTimeline).toBe(name)

			const card = cardFor(canvasElement, name)
			if (!card) throw new Error(`no card for beam ${name}`)
			await expect(getComputedStyle(card).viewTimelineName).toBe(name)
		}
	},
} satisfies Story

/**
 * Many groups in a short viewport. Two things must hold at once, and each is a
 * defect this component actually shipped.
 *
 * A beam must land on its card. The length was once derived from scroll progress
 * over the plain `cover` range against a viewport-sized overlay — two spans that
 * do not match the distance the beam covers — so it fell short near the top of
 * the screen and overshot near the bottom. It is exact now only because the
 * range and the overlay both describe that same distance, and either one drifting
 * back would show up here as a gap between the beam's foot and the card.
 *
 * A beam for a concert the fan has not reached must be dark. The animation once
 * carried `animation-fill-mode: both`, whose backwards fill held the opening
 * keyframe — the full-length beam — so every matched concert in the timetable lit
 * up at once.
 */
export const BeamsDarkOffScreen = {
	render: () => highwayStory(MANY_GROUPS),
	play: async ({ canvasElement }) => {
		const scroll = canvasElement.querySelector<HTMLElement>('.concert-scroll')
		if (!scroll) throw new Error('concert-scroll not rendered')

		// A view timeline can only be declared while its group is being rendered,
		// so the component re-declares them once the browser has settled which
		// groups those are. Let that frame happen before measuring.
		await new Promise((r) =>
			requestAnimationFrame(() => requestAnimationFrame(r)),
		)

		const edge = scroll.getBoundingClientRect()

		const beams = [
			...canvasElement.querySelectorAll<HTMLElement>('.laser-beam'),
		]
		await expect(beams.length).toBeGreaterThan(10)

		let offScreen = 0
		let offScreenLit = 0
		let onScreenLit = 0
		for (const beam of beams) {
			const card = cardFor(canvasElement, beam.dataset.beamTimeline ?? '')
			if (!card) continue
			const box = card.getBoundingClientRect()
			const rect = beam.getBoundingClientRect()
			const lit = rect.height > 1

			if (box.top < edge.top || box.top > edge.bottom) {
				offScreen += 1
				if (lit) offScreenLit += 1
				continue
			}
			if (!lit) continue
			onScreenLit += 1

			// The beam's foot sits on the card's top edge. A tolerance of 1px is for
			// fractional layout — anything larger is the mapping having drifted.
			await expect(Math.abs(rect.bottom - box.top)).toBeLessThan(1)
		}

		// The story only proves anything if there is something off screen to prove
		// it about, and something on screen to measure.
		await expect(offScreen).toBeGreaterThan(5)
		await expect(offScreenLit).toBe(0)
		await expect(onScreenLit).toBeGreaterThan(0)
	},
} satisfies Story

/**
 * Leaving the timetable deep in the list and coming back to the same date.
 *
 * Coming back destroys every group, and the window is then built around the
 * remembered date, so the dates above it do not exist yet and a saved pixel
 * offset would count past a different set of groups. What is saved is therefore
 * the date at the top edge, and the assertion is that the fan gets that date
 * back — not that some number round trips.
 */
export const ScrollAnchorSurvivesRerender = {
	render: () => highwayStory(UNEVEN_GROUPS),
	play: async ({ canvasElement }) => {
		const host = canvasElement.querySelector<HTMLElement>('concert-highway')
		if (!host) throw new Error('concert-highway not rendered')
		const vm = CustomElement.for<ConcertHighway>(host).viewModel
		const scroll = canvasElement.querySelector<HTMLElement>('.concert-scroll')
		if (!scroll) throw new Error('concert-scroll not rendered')

		const settle = async () => {
			for (let i = 0; i < 3; i++) {
				await new Promise((r) => requestAnimationFrame(() => r(null)))
			}
		}
		const topDateKey = () => {
			const edge = scroll.getBoundingClientRect().top
			for (const group of scroll.querySelectorAll<HTMLElement>(
				'[data-date-key]',
			)) {
				if (group.getBoundingClientRect().bottom > edge + 0.5) {
					return group.dataset.dateKey
				}
			}
			return undefined
		}

		// Scroll the way a fan does, a screen at a time, so the window grows the
		// way it does in use.
		for (let i = 1; i <= 8; i++) {
			scroll.scrollTop = i * scroll.clientHeight
			await settle()
		}
		const left = topDateKey()
		await expect(left).toBeDefined()
		// Deep enough that the remembered date is not in the first window.
		await expect(scroll.scrollTop).toBeGreaterThan(1000)

		const saved = vm.scrollAnchor
		await expect(saved?.dateKey).toBe(left)

		// Leave and come back: every group element is destroyed and rebuilt, and
		// the window is built afresh around the remembered date — the way the
		// dashboard hands it over on re-entry — so that date exists to land on.
		vm.dateGroups = []
		await settle()
		vm.initialAnchor = saved ?? null
		vm.dateGroups = UNEVEN_GROUPS
		await settle()

		vm.scrollAnchor = saved
		await settle()

		await expect(topDateKey()).toBe(left)
	},
} satisfies Story

/**
 * The loading placeholder. A new visual state gets its own story per the repo's
 * story contract — and this one earns it, because its whole purpose is that the
 * swap to real concerts moves nothing: it is built from the timetable's own
 * structure, so its lanes must line up with the stage header exactly as real
 * content does.
 */
export const LoadingPlaceholder = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="block-size: 560px; display: grid;">
					<concert-highway date-groups.bind="[]" loading.bind="true" readonly.bind="true"></concert-highway>
				</div>
			`,
			props: {},
			register: [ConcertHighway, EventCard, BeamVarsCustomAttribute],
		}),
	play: async ({ canvasElement }) => {
		// The frame is on screen while the concerts are not — that is the point.
		await expect(
			canvasElement.querySelectorAll('.stage-header > span'),
		).toHaveLength(3)

		const rows = [
			...canvasElement.querySelectorAll<HTMLElement>('.date-group-skeleton'),
		]
		await expect(rows.length).toBeGreaterThan(0)
		await assertLanesAlignWithStageHeader(canvasElement, 3)

		// Decorative only: it must not be announced, and it must not animate in —
		// animating a placeholder only delays the content it stands in for.
		for (const row of rows) {
			await expect(row.getAttribute('aria-hidden')).toBe('true')
			await expect(getComputedStyle(row).animationName).toBe('none')
		}

		// No real cards yet.
		await expect(canvasElement.querySelector('.event-card')).toBeNull()
	},
} satisfies Story
