import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { ArtistColorCustomAttribute } from '../../custom-attributes/artist-color'
import { PressFeedbackCustomAttribute } from '../../custom-attributes/press-feedback'
import type { Concert, JourneyStatus, LaneType } from '../../entities/concert'
import { EventCard } from './event-card'

/**
 * Build a synthetic dashboard concert. The card renders purely from this object,
 * so stories need neither RPC nor auth — which is exactly what makes the matched
 * card's visual identity verifiable in isolation after the render-cost change
 * removed the dead `color-drift` custom-property animation.
 */
function makeEvent(overrides: Partial<Concert> = {}): Concert {
	return {
		id: 'ev-1',
		artistName: 'VAUNDY',
		artistId: 'artist-1',
		venueName: 'Zepp DiverCity',
		locationLabel: '東京',
		date: new Date('2026-07-15T19:00:00+09:00'),
		startTime: '19:00',
		title: 'Summer Live 2026',
		sourceUrl: 'https://example.com',
		hypeLevel: 'home',
		matched: false,
		...overrides,
	}
}

// All stories drive the card through defineAureliaStory so the card's own custom
// attributes (`artist-color`, `press-feedback`) are registered alongside it.
function cardStory(event: Concert, lane: LaneType = 'home') {
	return defineAureliaStory({
		template: `<event-card event.bind="event" lane.bind="lane" readonly.bind="true"></event-card>`,
		props: { event, lane },
		register: [
			EventCard,
			ArtistColorCustomAttribute,
			PressFeedbackCustomAttribute,
		],
	})
}

const meta = {
	title: 'LiveHighway/EventCard',
	component: EventCard,
	tags: ['test', 'autodocs'],
	argTypes: {
		lane: {
			control: 'select',
			options: ['home', 'nearby', 'away'],
			description:
				'Proximity lane; drives padding/radius and label visibility.',
		},
	},
} satisfies Meta<typeof EventCard>

export default meta
type Story = StoryObj<typeof meta>

/** Baseline: an unmatched card — vivid diagonal gradient, no spotlight. */
export const Unmatched = {
	render: () => cardStory(makeEvent({ matched: false }), 'nearby'),
	play: async ({ canvasElement }) => {
		const article = canvasElement.querySelector<HTMLElement>('.event-card')
		if (!article) throw new Error('event-card not rendered')
		await expect(article.hasAttribute('data-matched')).toBe(false)
		// Unmatched cards carry a gradient background but no spotlight border/shadow.
		const style = getComputedStyle(article)
		await expect(style.backgroundImage).toContain('gradient')
	},
} satisfies Story

/**
 * Matched (hype-matched) card — the festival spotlight treatment. This story is
 * the regression guard for the render-cost change: it asserts the neon identity
 * (border + multi-layer box-shadow + gradient) is fully intact while proving the
 * removed `color-drift` per-frame custom-property animation is gone.
 */
export const Matched = {
	render: () => cardStory(makeEvent({ matched: true }), 'home'),
	play: async ({ canvasElement }) => {
		const article = canvasElement.querySelector<HTMLElement>('.event-card')
		if (!article) throw new Error('event-card not rendered')
		const style = getComputedStyle(article)

		// Matched marker + neon identity intact.
		await expect(article.hasAttribute('data-matched')).toBe(true)
		await expect(style.backgroundImage).toContain('gradient')
		await expect(style.borderTopWidth).toBe('2px')
		await expect(style.boxShadow).not.toBe('none')

		// The color identity source (--artist-hue, set by the artist-color
		// attribute) is present …
		await expect(style.getPropertyValue('--artist-hue').trim()).not.toBe('')
		// … while the dead derived var removed by this change is absent, and the
		// per-frame `color-drift` animation no longer drives style recalcalation.
		await expect(style.getPropertyValue('--artist-color').trim()).toBe('')
		await expect(style.animationName).not.toContain('color-drift')
	},
} satisfies Story

/** Matched card with a ticket-journey status badge (e.g. applied). */
export const MatchedWithJourneyBadge = {
	render: () =>
		cardStory(
			makeEvent({ matched: true, journeyStatus: 'applied' as JourneyStatus }),
			'home',
		),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByTestId('journey-badge')).toBeInTheDocument()
	},
} satisfies Story
