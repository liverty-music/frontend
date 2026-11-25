import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import {
	finishMotion,
	nextPaint,
	pausableAnimations,
	seekMotion,
} from '../../../../.storybook/motion'
import { transitionsEnded } from '../../../../.storybook/transitions-ended'
import { ActionMenuGlyph } from '../action-menu-glyph/action-menu-glyph'
import { ActionMenuToggle } from './action-menu-toggle'

const meta = {
	title: 'Components/ActionMenuToggle',
	component: ActionMenuToggle,
} satisfies Meta<typeof ActionMenuToggle>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The FAB in the top layer, as `action-menu` shows it, with the arc's popover it
 * controls (empty here). `open` selects the glyph: equalizer or close cross.
 */
const render =
	(open: boolean): Story['render'] =>
	() =>
		defineAureliaStory({
			template: `
				<action-menu-toggle open.bind="open"></action-menu-toggle>
				<dialog id="action-menu-panel" popover="auto" aria-label="Actions"></dialog>
			`,
			props: { open },
			register: [ActionMenuToggle, ActionMenuGlyph],
		})

async function shown(root: HTMLElement): Promise<HTMLButtonElement> {
	const button = root.querySelector<HTMLButtonElement>('.action-menu-toggle')
	if (!button) throw new Error('no FAB')
	button.showPopover()
	// It grows from nothing as it shows; measure it once it has.
	await transitionsEnded(button)
	return button
}

/** Collapsed: the equalizer glyph, a 56 px round FAB. */
export const Closed = {
	render: render(false),
	play: async ({ canvasElement }) => {
		const button = await shown(canvasElement)
		await expect(button.getAttribute('aria-expanded')).toBe('false')
		// The icon-only button shows its name as a tooltip on hover and focus.
		await expect(button.title).not.toBe('')
		await expect(button.title).toBe(button.getAttribute('aria-label'))
		await expect(button.getBoundingClientRect().width).toBe(56)
		// It grows from nothing as it shows, on the spatial spring.
		await expect(getComputedStyle(button).transitionProperty).toContain('scale')
		const close = button.querySelector('.fab-close') as Element
		await expect(getComputedStyle(close).opacity).toBe('0')
	},
} satisfies Story

/** Expanded: the close cross replaces the equalizer. */
export const Open = {
	render: render(true),
	play: async ({ canvasElement }) => {
		const button = await shown(canvasElement)
		await expect(button.getAttribute('aria-expanded')).toBe('true')
		await expect(
			button.querySelector('.action-menu-glyph')?.getAttribute('data-open'),
		).toBe('true')
	},
} satisfies Story

/**
 * Replays the entry: the FAB is hidden and shown again, and the story steps
 * through the growth. A still story cannot show a motion, so the steps stand
 * for it: the FAB starts small, grows, and ends at its full size.
 */
export const GrowsWhenShown = {
	render: render(false),
	play: async ({ canvasElement }) => {
		const button = await shown(canvasElement)
		// Taken out of rendering for a frame (the app creates the FAB and shows
		// it in one task), so showing it again starts from the entry style.
		button.hidePopover()
		button.style.display = 'none'
		await nextPaint()
		button.style.display = ''
		button.showPopover()
		await nextPaint()
		const growth = pausableAnimations(button).filter(
			(a) => (a as CSSTransition).transitionProperty === 'scale',
		)
		await expect(growth).toHaveLength(1)
		const scale = () => Number.parseFloat(getComputedStyle(button).scale)
		await seekMotion(growth, 0)
		await expect(scale()).toBeLessThan(0.3)
		await seekMotion(growth, 0.5)
		await expect(scale()).toBeGreaterThan(0.3)
		finishMotion(growth)
		await transitionsEnded(button)
		await expect(scale()).toBe(1)
	},
} satisfies Story
