import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import {
	DiscoverySwapButton,
	type DiscoveryView,
} from './discovery-swap-button'

const meta = {
	title: 'Components/DiscoverySwapButton',
	component: DiscoverySwapButton,
	tags: ['test', 'autodocs'],
	argTypes: {
		view: {
			control: { type: 'inline-radio' },
			options: ['artists', 'nearby'],
			description:
				'The Discovery view on screen; its glyph is drawn large, the other one as the corner badge.',
		},
	},
	args: { view: 'artists' },
} satisfies Meta<typeof DiscoverySwapButton>

export default meta
type Story = StoryObj<typeof meta>

/** A host that owns the view, as Discovery does, so a tap switches it. */
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template:
			'<discovery-swap-button view.bind="view" on-swap.bind="() => toggle()"></discovery-swap-button>',
		props: {
			view: args.view,
			toggle(this: { view: DiscoveryView }) {
				this.view = this.view === 'artists' ? 'nearby' : 'artists'
			},
		},
		register: [DiscoverySwapButton],
	})

function parts(canvasElement: HTMLElement) {
	const icon = canvasElement.querySelector<SVGSVGElement>('.swap-icon')
	const artists = canvasElement.querySelector<SVGGElement>(
		'[data-testid="swap-glyph-artists"]',
	)
	const nearby = canvasElement.querySelector<SVGGElement>(
		'[data-testid="swap-glyph-nearby"]',
	)
	const badge = canvasElement.querySelector<SVGCircleElement>('.swap-badge')
	if (!icon || !artists || !nearby || !badge) throw new Error('icon parts')
	return { icon, artists, nearby, badge }
}

/**
 * Which glyph is large over the arrows and which sits on the corner badge:
 * the large one is wider, and the small one's centre is on the badge.
 */
function slots(canvasElement: HTMLElement) {
	const { artists, nearby, badge } = parts(canvasElement)
	const centre = (r: DOMRect) => ({
		x: r.x + r.width / 2,
		y: r.y + r.height / 2,
	})
	const a = artists.getBoundingClientRect()
	const n = nearby.getBoundingClientRect()
	const b = badge.getBoundingClientRect()
	const [large, small, smallRect] =
		a.width > n.width
			? (['artists', 'nearby', n] as const)
			: (['nearby', 'artists', a] as const)
	const s = centre(smallRect)
	const onBadge =
		s.x >= b.left && s.x <= b.right && s.y >= b.top && s.y <= b.bottom
	return { large, small, onBadge }
}

/** Lets the swap motion finish (instant under reduced motion). */
async function settled(canvasElement: HTMLElement, large: DiscoveryView) {
	await waitFor(() => expect(slots(canvasElement).large).toBe(large), {
		timeout: 2000,
	})
	await new Promise((r) => setTimeout(r, 700))
}

/** On the artist bubbles: the bubbles large, the ticket on the badge. */
export const Artists = {
	render,
	args: { view: 'artists' },
	play: async ({ canvasElement }) => {
		await settled(canvasElement, 'artists')
		await expect(slots(canvasElement)).toEqual({
			large: 'artists',
			small: 'nearby',
			onBadge: true,
		})
		await expect(
			within(canvasElement).getByRole('button', { name: '近くのライブ' }),
		).toBeVisible()
	},
} satisfies Story

/** On the All Nearby view: the ticket large, the bubbles on the badge. */
export const Nearby = {
	render,
	args: { view: 'nearby' },
	play: async ({ canvasElement }) => {
		await settled(canvasElement, 'nearby')
		await expect(slots(canvasElement)).toEqual({
			large: 'nearby',
			small: 'artists',
			onBadge: true,
		})
		await expect(
			within(canvasElement).getByRole('button', { name: 'アーティスト' }),
		).toBeVisible()
	},
} satisfies Story

/**
 * A tap switches the view and back. The glyphs trade places and the arrows
 * keep turning the same way (the half turns add up). Under reduced motion
 * the icon changes at once, without any transition or animation.
 */
export const Swapping = {
	tags: ['reduced-motion'],
	render,
	args: { view: 'artists' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const { icon } = parts(canvasElement)

		// @spec components/infrastructure/fan/web/route/discovery "Switching to the All Nearby view"
		await userEvent.click(canvas.getByRole('button', { name: '近くのライブ' }))
		await settled(canvasElement, 'nearby')
		await expect(slots(canvasElement)).toEqual({
			large: 'nearby',
			small: 'artists',
			onBadge: true,
		})
		await expect(
			canvas.getByRole('button', { name: 'アーティスト' }),
		).toBeVisible()
		await expect(icon.style.getPropertyValue('--ring-turn')).toBe('1')

		// @spec components/infrastructure/fan/web/route/discovery "Switching back to the artist bubbles"
		await userEvent.click(canvas.getByRole('button', { name: 'アーティスト' }))
		await settled(canvasElement, 'artists')
		await expect(slots(canvasElement)).toEqual({
			large: 'artists',
			small: 'nearby',
			onBadge: true,
		})
		await expect(
			canvas.getByRole('button', { name: '近くのライブ' }),
		).toBeVisible()
		// Two half turns, not one forward and one back.
		await expect(icon.style.getPropertyValue('--ring-turn')).toBe('2')

		// @spec components/infrastructure/fan/web/route/discovery "Reduced motion"
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		const ring = canvasElement.querySelector('.swap-ring')
		const glyph = canvasElement.querySelector('.swap-glyph')
		const sparkle = canvasElement.querySelector('.swap-sparkle')
		if (!ring || !glyph || !sparkle) throw new Error('icon parts')
		for (const el of [ring, glyph]) {
			const { transitionProperty, transitionDuration } = getComputedStyle(el)
			const moves = transitionProperty !== 'none' && transitionDuration !== '0s'
			await expect(moves).toBe(!reduced)
		}
		await expect(getComputedStyle(sparkle).animationName).toBe(
			reduced ? 'none' : 'swap-twinkle',
		)
	},
} satisfies Story
