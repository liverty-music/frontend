import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement } from 'aurelia'
import { expect } from 'storybook/test'
import { ArtistColorCustomAttribute } from '../../custom-attributes/artist-color'
import { BeamVarsCustomAttribute } from '../../custom-attributes/beam-vars'
import { PressFeedbackCustomAttribute } from '../../custom-attributes/press-feedback'
import { BeamTimelineCustomAttribute } from '../../custom-attributes/view-timeline'
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
		hypeLevel: lane === 'home' ? 'home' : lane === 'nearby' ? 'nearby' : 'away',
		matched,
	}
}

/**
 * Two date groups with matched cards across lanes. Multiple groups are required
 * to exercise the render-cost change: `content-visibility: auto` on each
 * date-group `<li>` and the sticky date separators only matter across a
 * multi-group scroll, and laser beams are generated one-per-matched-card.
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

function highwayStory(dateGroups: DateGroup[], hideAway = false) {
	return defineAureliaStory({
		// A sized grid host so the highway (block-size: 100%) lays out its lanes.
		template: `
			<div style="block-size: 560px; display: grid;">
				<concert-highway date-groups.bind="dateGroups" show-beams.bind="true" readonly.bind="true" hide-away.bind="hideAway"></concert-highway>
			</div>
		`,
		props: { dateGroups, hideAway },
		register: [
			ConcertHighway,
			EventCard,
			ArtistColorCustomAttribute,
			PressFeedbackCustomAttribute,
			BeamVarsCustomAttribute,
			BeamTimelineCustomAttribute,
		],
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
		...canvasElement.querySelectorAll<HTMLElement>('.concert-scroll > li'),
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
 * The three-lane timetable. Guards the layout contract that viewport-scoped
 * rendering depends on: lanes line up with the stage header, the date group owns
 * its columns rather than subgridding through the scroll container, the date
 * separators stay `position: sticky`, and one laser beam renders per matched
 * card (the beam JS resolves geometry from data, so beams exist even for a
 * matched card in a group that is skipped while off screen).
 */
export const PopulatedTimetable = {
	render: () => highwayStory(DATE_GROUPS),
	play: async ({ canvasElement }) => {
		const groups = canvasElement.querySelectorAll<HTMLElement>(
			'.concert-scroll > li',
		)
		await expect(groups.length).toBe(DATE_GROUPS.length)

		await assertLanesAlignWithStageHeader(canvasElement, 3)

		// The date group must NOT be a subgrid participant. This is the
		// precondition for per-group containment: `content-visibility` establishes
		// layout containment, which severs a subgrid chain that crosses the
		// contained boundary — that is what collapsed the lanes to full width and
		// forced the P2 revert. The group declaring its own columns is what makes
		// containment safe, so assert the columns resolve to lengths, not `subgrid`.
		await expect(getComputedStyle(groups[0]).gridTemplateColumns).not.toContain(
			'subgrid',
		)

		// Sticky date separators.
		const separator =
			canvasElement.querySelector<HTMLElement>('.date-separator')
		if (!separator) throw new Error('date-separator not rendered')
		await expect(getComputedStyle(separator).position).toBe('sticky')

		// One laser beam per matched card. The beam set is derived from data, so it
		// is complete regardless of which groups are currently rendered.
		const beams = canvasElement.querySelectorAll('.laser-beam')
		await expect(beams.length).toBe(MATCHED_COUNT)
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
 * the host, a matching `view-timeline` on the card, and `animation-timeline` on
 * the beam. It deliberately does not assert beam geometry — that is now the
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
			const idx = beam.dataset.beamAnchor
			const name = `--beam-${idx}`

			// The beam is not a descendant of its card, so the name must be scoped
			// on a common ancestor or the timeline silently fails to resolve.
			await expect(scope).toContain(name)
			await expect(getComputedStyle(beam).animationTimeline).toBe(name)

			const card = canvasElement.querySelector<HTMLElement>(
				`[data-beam-index="${idx}"]`,
			)
			if (!card) throw new Error(`no card for beam ${idx}`)
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
			const card = canvasElement.querySelector<HTMLElement>(
				`[data-beam-index="${beam.dataset.beamAnchor}"]`,
			)
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
 * This is a real defect twice over, so the story reproduces the mechanism rather
 * than the symptom. Off-screen groups are sized from an estimate until they
 * render, and the browser remembers each real height only for as long as the
 * element lives — navigation destroys them all. Emptying and refilling the
 * timetable does the same thing here: every group comes back as a new element
 * with its estimate restored.
 *
 * A saved pixel offset cannot survive that, because the same number now counts
 * past a different set of groups; measured against a 225-group list it landed 41
 * groups away. What is saved is therefore the date at the top edge, and the
 * assertion is that the fan gets that date back — not that some number round
 * trips.
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

		// Scroll the way a fan does, a screen at a time, so the groups passed
		// through actually render and the browser learns their real heights. A
		// single jump would leave every estimate untouched and prove nothing.
		for (let i = 1; i <= 8; i++) {
			scroll.scrollTop = i * scroll.clientHeight
			await settle()
		}
		const left = topDateKey()
		await expect(left).toBeDefined()
		// Deep enough that the estimates have something to be wrong about.
		await expect(scroll.scrollTop).toBeGreaterThan(1000)

		const saved = vm.scrollAnchor
		await expect(saved?.dateKey).toBe(left)

		// Leave and come back: every group element is destroyed and rebuilt, which
		// is what discards the remembered heights.
		vm.dateGroups = []
		await settle()
		vm.dateGroups = UNEVEN_GROUPS
		await settle()
		await expect(scroll.scrollTop).toBe(0)

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
			register: [
				ConcertHighway,
				EventCard,
				ArtistColorCustomAttribute,
				PressFeedbackCustomAttribute,
				BeamVarsCustomAttribute,
				BeamTimelineCustomAttribute,
				BeamTimelineCustomAttribute,
			],
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
