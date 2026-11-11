import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { consoleStoryParameters } from '../../ui/story-support'
import { BrandLockup } from './brand-lockup'

const meta = {
	title: 'Console/Shell/BrandLockup',
	component: BrandLockup,
	parameters: consoleStoryParameters,
	argTypes: {
		href: { control: 'text' },
		deep: {
			control: 'boolean',
			description: 'Below a destination: hidden on a compact window.',
		},
	},
	args: { href: '#home', deep: false },
} satisfies Meta<typeof BrandLockup>

export default meta
type Story = StoryObj<typeof meta>

/** The window width the bar's container query reads (`shell`). */
const render =
	(windowWidth: number): Story['render'] =>
	(args) =>
		defineAureliaStory({
			template: `
				<div style="container: shell / inline-size; inline-size:${windowWidth}px; display:flex; padding:8px; background:var(--md-sys-color-surface)">
					<brand-lockup href.bind="href" deep.bind="deep"></brand-lockup>
				</div>
			`,
			props: args,
			register: [BrandLockup],
		})

const brandOf = (canvasElement: HTMLElement): HTMLElement => {
	const brand = canvasElement.querySelector<HTMLElement>('.brand')
	if (!brand) throw new Error('brand lockup not rendered')
	return brand
}

/**
 * Compact: Liverty Music over Organizer Console, in a grid (the bar's flex
 * item, so its inline-grid computes to grid).
 */
export const Compact = {
	render: render(400),
	play: async ({ canvasElement }) => {
		const brand = brandOf(canvasElement)
		await expect(getComputedStyle(brand).display).toBe('grid')
		await expect(brand.getAttribute('aria-label')).not.toBe('')
	},
} satisfies Story

/** Medium and wider: the two names on one line. */
export const Medium = {
	render: render(720),
	play: async ({ canvasElement }) => {
		await expect(getComputedStyle(brandOf(canvasElement)).display).toBe('flex')
	},
} satisfies Story

/** Compact, below a destination: the back arrow takes its place. */
export const CompactBelowDestination = {
	args: { deep: true },
	render: render(400),
	play: async ({ canvasElement }) => {
		await expect(getComputedStyle(brandOf(canvasElement)).display).toBe('none')
	},
} satisfies Story
