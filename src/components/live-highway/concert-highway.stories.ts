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

		// P2: viewport-scoped layout is applied to each date group.
		const first = getComputedStyle(groups[0])
		await expect(first.contentVisibility).toBe('auto')
		await expect(first.containIntrinsicBlockSize).toContain('160px')

		// Sticky date separators survive the containment (Open Question guard).
		const separator =
			canvasElement.querySelector<HTMLElement>('.date-separator')
		if (!separator) throw new Error('date-separator not rendered')
		await expect(getComputedStyle(separator).position).toBe('sticky')

		// Three lanes per group render, and the subgrid columns are content-driven
		// by the fixed parent tracks (so containment cannot shift them).
		await expect(groups[0].querySelectorAll('.lane').length).toBe(3)

		// One laser beam per matched card — beams are generated from data, so they
		// exist even when a matched card sits in an off-screen (skipped) group.
		const beams = canvasElement.querySelectorAll('.laser-beam')
		await expect(beams.length).toBe(MATCHED_COUNT)
	},
} satisfies Story
