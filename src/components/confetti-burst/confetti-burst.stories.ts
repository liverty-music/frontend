import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { makeConfetti } from '../celebration-overlay/celebration-overlay'
import { ConfettiBurst } from './confetti-burst'

const meta = {
	title: 'Components/ConfettiBurst',
	component: ConfettiBurst,
} satisfies Meta<typeof ConfettiBurst>

export default meta
type Story = StoryObj<typeof meta>

/**
 * One burst from the centre of the screen. With reduced motion the burst is
 * not shown at all.
 */
export const Burst = {
	tags: ['reduced-motion'],
	render: () =>
		defineAureliaStory({
			template: '<confetti-burst pieces.bind="pieces"></confetti-burst>',
			props: { pieces: makeConfetti(12) },
			register: [ConfettiBurst],
		}),
	play: async ({ canvasElement }) => {
		const container = canvasElement.querySelector('.confetti-container')
		if (!container) throw new Error('no confetti container')
		await expect(container.querySelectorAll('.confetti')).toHaveLength(12)
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		await expect(getComputedStyle(container).display).toBe(
			reduced ? 'none' : 'block',
		)
	},
} satisfies Story
