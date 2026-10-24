import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { SuccessMark } from './success-mark'

const meta = {
	title: 'Components/SuccessMark',
	component: SuccessMark,
	tags: ['test', 'autodocs'],
} satisfies Meta<typeof SuccessMark>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The mark of a finished action. Tagged `reduced-motion`, so it also runs with
 * motion reduced: the ring and check draw and the mark pulses once with full
 * motion, and the finished mark shows at once without it. Not screenshotted,
 * because the drawing makes the frame non-deterministic.
 */
export const Default = {
	tags: ['reduced-motion'],
	render: () =>
		defineAureliaStory({
			template: '<success-mark></success-mark>',
			register: [SuccessMark],
		}),
	play: async ({ canvasElement }) => {
		const host = canvasElement.querySelector<HTMLElement>('success-mark')
		const svg = host?.querySelector<SVGSVGElement>('svg')
		const ring = host?.querySelector<SVGElement>('.success-mark-ring')
		const check = host?.querySelector<SVGElement>('.success-mark-check')
		if (!host || !svg || !ring || !check) throw new Error('no success mark')

		// Decorative: the message beside it says what happened.
		await expect(svg.getAttribute('aria-hidden')).toBe('true')
		// Large enough to read as the result of the screen, not an inline icon.
		await expect(host.getBoundingClientRect().width).toBeGreaterThanOrEqual(40)

		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		const ms = (el: Element) =>
			Number.parseFloat(getComputedStyle(el).animationDuration) * 1000
		if (reduced) {
			for (const el of [svg, ring, check]) await expect(ms(el)).toBe(0)
		} else {
			await expect(getComputedStyle(ring).animationName).toBe(
				'success-mark-draw',
			)
			await expect(getComputedStyle(check).animationName).toBe(
				'success-mark-draw',
			)
			await expect(getComputedStyle(svg).animationName).toBe(
				'success-mark-pulse',
			)
			for (const el of [svg, ring, check]) {
				await expect(ms(el)).toBeGreaterThan(0)
			}
		}

		// Either way it ends as the finished mark.
		await Promise.all(
			[svg, ring, check].flatMap((el) =>
				el.getAnimations().map((a) => a.finished),
			),
		)
		await expect(getComputedStyle(check).strokeDashoffset).toBe('0px')
	},
} satisfies Story
