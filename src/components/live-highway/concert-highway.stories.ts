import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { ArtistColorCustomAttribute } from '../../custom-attributes/artist-color'
import { BeamVarsCustomAttribute } from '../../custom-attributes/beam-vars'
import { PressFeedbackCustomAttribute } from '../../custom-attributes/press-feedback'
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

function highwayStory(dateGroups: DateGroup[]) {
	return defineAureliaStory({
		// A sized grid host so the highway (block-size: 100%) lays out its lanes.
		template: `
			<div style="block-size: 560px; display: grid;">
				<concert-highway date-groups.bind="dateGroups" show-beams.bind="true" readonly.bind="true"></concert-highway>
			</div>
		`,
		props: { dateGroups },
		register: [
			ConcertHighway,
			EventCard,
			ArtistColorCustomAttribute,
			PressFeedbackCustomAttribute,
			BeamVarsCustomAttribute,
		],
	})
}

const meta = {
	title: 'LiveHighway/ConcertHighway',
	component: ConcertHighway,
	tags: ['test', 'autodocs'],
} satisfies Meta<typeof ConcertHighway>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Verifies the P2 viewport-scoping contract: each date-group `<li>` carries
 * `content-visibility: auto` + `contain-intrinsic-block-size`, the date
 * separators stay `position: sticky`, and one laser beam renders per matched
 * card (the beam JS still resolves geometry under containment).
 */
export const PopulatedTimetable = {
	render: () => highwayStory(DATE_GROUPS),
	play: async ({ canvasElement }) => {
		const groups = canvasElement.querySelectorAll<HTMLElement>(
			'.concert-scroll > li',
		)
		await expect(groups.length).toBe(DATE_GROUPS.length)

		// Lane/column layout regression guard. `content-visibility` (P2) was
		// reverted: it always adds paint containment, which both disables the
		// `<li>` subgrid (cards overflowed their lane) and clipped the matched
		// card's spotlight glow, and the only un-clip mechanism (overflow-clip-
		// margin) is Firefox-only and conflicts with the sticky header. So there
		// must be NO content-visibility here, the `<li>` must keep its subgrid,
		// each lane must be ~1/3 of the row, and a card must not spill past its lane.
		const lanes = groups[0].querySelectorAll<HTMLElement>('.lane')
		await expect(lanes.length).toBe(3)
		await expect(getComputedStyle(lanes[0]).contentVisibility).toBe('visible')
		await expect(getComputedStyle(groups[0]).gridTemplateColumns).toContain(
			'subgrid',
		)
		const rowW = groups[0].getBoundingClientRect().width
		const laneW = lanes[0].getBoundingClientRect().width
		await expect(laneW).toBeLessThan(rowW * 0.5) // one column, not full width
		const card = groups[0].querySelector<HTMLElement>('.event-card')
		if (!card) throw new Error('event-card not rendered')
		await expect(card.getBoundingClientRect().width).toBeLessThanOrEqual(laneW)

		// Sticky date separators.
		const separator =
			canvasElement.querySelector<HTMLElement>('.date-separator')
		if (!separator) throw new Error('date-separator not rendered')
		await expect(getComputedStyle(separator).position).toBe('sticky')

		// One laser beam per matched card — beams are generated from data, so they
		// exist even when a matched card sits in an off-screen (skipped) group.
		const beams = canvasElement.querySelectorAll('.laser-beam')
		await expect(beams.length).toBe(MATCHED_COUNT)
	},
} satisfies Story
