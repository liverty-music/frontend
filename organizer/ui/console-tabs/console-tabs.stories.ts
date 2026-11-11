import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor } from 'storybook/test'
import { canvasOf, consoleStoryParameters, deepQuery } from '../story-support'
import { ConsoleTabs } from './console-tabs'

const meta = {
	title: 'Console/ConsoleTabs',
	component: ConsoleTabs,
	parameters: consoleStoryParameters,
	argTypes: {
		active: { control: 'select', options: ['sales', 'reception'] },
	},
	args: { active: 'sales' },
} satisfies Meta<typeof ConsoleTabs>

export default meta
type Story = StoryObj<typeof meta>

const TABS = [
	{ id: 'sales', labelKey: 'event.tab.sales', href: '#sales' },
	{ id: 'reception', labelKey: 'event.tab.reception', href: '#reception' },
]

/** The host follows the clicked tab, as the router does in the console. */
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `
			<div style="padding:16px; background:var(--md-sys-color-surface)">
				<console-tabs tabs.bind="tabs" active.bind="active" label="公演の管理" click.trigger="select($event)"></console-tabs>
			</div>
		`,
		props: {
			...args,
			tabs: TABS,
			select(this: { active: string }, event: Event) {
				// The tab is inside the tabs' shadow root: read it from the path.
				const tab = event
					.composedPath()
					.find(
						(node): node is HTMLElement =>
							node instanceof HTMLElement && node.hasAttribute('data-tab'),
					)
				if (!tab) return
				event.preventDefault()
				this.active = tab.getAttribute('data-tab') ?? this.active
			},
		},
	})

function indicatorOf(root: HTMLElement): HTMLElement {
	return deepQuery(root, '.indicator')
}

export const Sales = { render } satisfies Story

/**
 * Runs in both storybook projects: with motion the indicator slides (300 ms);
 * under reduced motion it moves at once.
 */
export const ReducedMotion = {
	tags: ['reduced-motion'],
	render,
	play: async ({ canvasElement, globals }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Reduced motion"
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		if (import.meta.env.MODE === 'test') {
			await expect(typeof globals.reducedMotion).toBe('boolean')
			await expect(reduce).toBe(globals.reducedMotion)
		}
		const canvas = canvasOf(canvasElement)
		const sales = canvas.getByRole('link', { name: '販売' }).element()
		const reception = canvas.getByRole('link', { name: '受付' }).element()
		const indicator = indicatorOf(canvasElement)
		await waitFor(() =>
			expect(indicator.getBoundingClientRect().width).toBeCloseTo(
				sales.getBoundingClientRect().width,
				0,
			),
		)

		const from = indicator.getBoundingClientRect().left
		const to = reception.getBoundingClientRect().left
		// Select the tab and read the slide in the same task (the tabs measure
		// in a microtask, which runs before this one resumes), so no frame can
		// advance the slide before it is held. A pointer click returns some
		// frames later, and on a loaded runner the slide may be over by then.
		reception.click()
		await Promise.resolve()

		await expect(reception).toHaveAttribute('aria-current', 'page')
		const duration = Number.parseFloat(
			getComputedStyle(indicator).transitionDuration,
		)
		const slide = indicator.getAnimations()
		if (reduce) {
			await expect(duration).toBe(0)
			await expect(slide).toHaveLength(0)
		} else {
			await expect(duration).toBeCloseTo(0.3, 5)
			await expect(duration).toBeLessThanOrEqual(0.5)
			// Halfway through, the indicator is between the two tabs.
			await expect(slide.length).toBeGreaterThan(0)
			for (const a of slide) {
				a.pause()
				a.currentTime = Number(a.effect?.getTiming().duration) / 2
			}
			const midway = indicator.getBoundingClientRect().left
			await expect(midway).toBeGreaterThan(from + 1)
			await expect(midway).toBeLessThan(to - 1)
			for (const a of slide) a.finish()
		}
		await expect(indicator.getBoundingClientRect().left).toBeCloseTo(to, 0)
	},
} satisfies Story
