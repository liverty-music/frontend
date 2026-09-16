import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
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
 * The reveal contract. Two mechanisms share the date group without competing,
 * because they drive different properties: first appearance is a transition
 * started by `@starting-style`, scroll reveal is a scroll-driven animation.
 *
 * Asserts the wiring rather than the motion — the visuals belong to the device
 * check. The duration assertion is the valuable one: a scroll-driven animation
 * maps its duration to the range, so a time value silently produces no
 * animation at all, with no error anywhere.
 */
export const RevealWiring = {
	render: () => highwayStory(DATE_GROUPS),
	play: async ({ canvasElement }) => {
		const group = canvasElement.querySelector<HTMLElement>('.date-group')
		if (!group) throw new Error('date-group not rendered')
		const style = getComputedStyle(group)

		// First appearance: a transition, staggered per group.
		await expect(style.transitionProperty).toContain('opacity')
		await expect(style.transitionDelay).not.toBe('0s')

		// Scroll reveal: position-driven, and `auto` duration is mandatory.
		await expect(style.animationTimeline).toBe('view()')
		await expect(style.animationRange).toBe('entry')
		await expect(style.animationDuration).toBe('auto')
		// `backwards` (not `both`) is what leaves a group past its entry range
		// contributing nothing, so the first-appearance transition stays in charge.
		await expect(style.animationFillMode).toBe('backwards')

		// The card must no longer carry its own entrance — it fired on every card
		// simultaneously, including ones the fan could not see.
		const card = canvasElement.querySelector<HTMLElement>('.event-card')
		if (!card) throw new Error('event-card not rendered')
		await expect(getComputedStyle(card).animationName).toBe('none')
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
