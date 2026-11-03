import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { artistHue } from '../../adapter/view/artist-color'
import type { Concert, JourneyStatus, LaneType } from '../../entities/concert'
import { EventCard } from './event-card'

/**
 * Build a synthetic dashboard concert. The card renders purely from this object,
 * so stories need neither RPC nor auth — which is exactly what makes the matched
 * card's visual identity verifiable in isolation after the render-cost change
 * removed the dead `color-drift` custom-property animation.
 */
function makeEvent(overrides: Partial<Concert> = {}): Concert {
	const artistName = overrides.artistName ?? 'VAUNDY'
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
		isFirstParty: false,
		hypeLevel: 'home',
		matched: false,
		artistHue: artistHue(artistName),
		...overrides,
	}
}

// All stories drive the card through defineAureliaStory so it renders through a
// real template, the way the timetable mounts it.
function cardStory(event: Concert, lane: LaneType = 'home') {
	return defineAureliaStory({
		template: `<event-card event.bind="event" lane.bind="lane" readonly.bind="true"></event-card>`,
		props: { event, lane },
		register: [EventCard],
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
		const style = getComputedStyle(article)

		// @spec components/infrastructure/fan/web/global/live-highway "Unmatched card shows the artist's color without light"
		// The artist's diagonal gradient behind a faint 1px border …
		await expect(style.backgroundImage).toContain('linear-gradient')
		await expect(style.borderTopWidth).toBe('1px')
		await expect(style.borderTopColor).toBe('oklch(1 0 0 / 0.12)')
		// … a fine grain at 8% opacity over it …
		const grain = getComputedStyle(article, '::after')
		await expect(grain.backgroundImage).toContain('url(')
		await expect(grain.opacity).toBe('0.08')
		// … and no light: no glow, no beam, no glowing name.
		await expect(style.boxShadow).toBe('none')
		await expect(getComputedStyle(article, '::before').maskImage).toBe('none')
		const name = article.querySelector<HTMLElement>('.artist-name')
		if (!name) throw new Error('artist name not rendered')
		await expect(getComputedStyle(name).textShadow).toBe('none')

		// @spec components/infrastructure/fan/web/global/live-highway "Card treatments hold still"
		await expect(style.animationName).toBe('none')
		await expect(grain.animationName).toBe('none')

		// @spec components/infrastructure/fan/web/global/live-highway "Artist name centered on the card"
		// The name is text, centered across the card, and no logo image is shown.
		await expect(name.textContent?.trim()).toBe('VAUNDY')
		await expect(article.querySelector('img')).toBeNull()
		const card = article.getBoundingClientRect()
		const box = name.getBoundingClientRect()
		await expect(
			Math.abs(box.left - card.left - (card.right - box.right)),
		).toBeLessThanOrEqual(1)

		// @spec components/infrastructure/fan/web/global/live-highway "Unmatched card name at full visibility"
		const nameStyle = getComputedStyle(name)
		await expect(nameStyle.opacity).toBe('1')
		await expect(nameStyle.filter).not.toMatch(/grayscale|brightness/)

		// @spec components/infrastructure/fan/web/global/live-highway "Text fallback versus location label"
		const label = article.querySelector<HTMLElement>('.location-label')
		if (!label) throw new Error('location label not rendered')
		await expect(Number.parseFloat(nameStyle.fontSize)).toBeGreaterThan(
			Number.parseFloat(getComputedStyle(label).fontSize),
		)
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

		// @spec components/infrastructure/fan/web/global/live-highway "Matched card is lit like a stage"
		// Matched marker + neon identity intact.
		await expect(article.hasAttribute('data-matched')).toBe(true)
		await expect(style.backgroundImage).toContain('linear-gradient')
		await expect(style.borderTopWidth).toBe('2px')
		await expect(style.boxShadow).not.toBe('none')
		await expect(style.boxShadow).toContain('inset')

		// @spec components/infrastructure/fan/web/global/live-highway "Matched card has a light beam from above"
		// A narrow cone anchored at the centre of the top edge, fading downward.
		const beam = getComputedStyle(article, '::before')
		await expect(beam.backgroundImage).toContain('linear-gradient')
		await expect(beam.maskImage).toContain('radial-gradient')
		await expect(beam.maskImage).toContain('at 50% 0%')

		// @spec components/infrastructure/fan/web/global/live-highway "Matched card artist name glows"
		const name = article.querySelector<HTMLElement>('.artist-name')
		if (!name) throw new Error('artist name not rendered')
		await expect(getComputedStyle(name).textShadow).not.toBe('none')

		// The color identity source (--artist-hue, handed to CSS from the
		// concert's precomputed hue) is present …
		await expect(style.getPropertyValue('--artist-hue').trim()).not.toBe('')
		// … while the dead derived var removed by this change is absent.
		await expect(style.getPropertyValue('--artist-color').trim()).toBe('')

		// @spec components/infrastructure/fan/web/route/dashboard "Idle timetable does no continuous rendering work"
		// @spec components/infrastructure/fan/web/global/live-highway "Card treatments hold still"
		// A card runs no animation at all, so an idle card never schedules
		// per-frame style recalculation. (The removed `color-drift` animation did.)
		await expect(style.animationName).toBe('none')
		await expect(beam.animationName).toBe('none')
		await expect(getComputedStyle(name).animationName).toBe('none')
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

/** First-party card the fan has bought tickets for: the purchased badge. */
export const FirstPartyPurchased = {
	render: () =>
		cardStory(
			makeEvent({
				matched: true,
				isFirstParty: true,
				purchasedTicketCount: 2,
				// A journey on a first-party concert is not shown.
				journeyStatus: 'applied' as JourneyStatus,
			}),
			'home',
		),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByTestId('purchased-badge')).toBeInTheDocument()
		await expect(canvas.queryByTestId('journey-badge')).toBeNull()
	},
} satisfies Story
