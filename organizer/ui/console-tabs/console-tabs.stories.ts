import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor, within } from 'storybook/test'
import { userEvent } from 'vitest/browser'
import { consoleStoryParameters } from '../story-support'
import { ConsoleTabs } from './console-tabs'

const meta = {
	title: 'Console/ConsoleTabs',
	component: ConsoleTabs,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		active: { control: 'select', options: ['sales', 'reception'] },
	},
	args: { active: 'sales' },
} satisfies Meta<typeof ConsoleTabs>

export default meta
type Story = StoryObj<typeof meta>

const TABS = [
	{ id: 'sales', label: '販売', href: '#sales' },
	{ id: 'reception', label: '受付', href: '#reception' },
]

/** The host follows the clicked tab, as the router does in the console. */
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `
			<div style="padding:16px; background:var(--md-color-surface)">
				<console-tabs tabs.bind="tabs" active.bind="active" label="公演の管理" click.trigger="select($event)"></console-tabs>
			</div>
		`,
		props: {
			...args,
			tabs: TABS,
			select(this: { active: string }, event: Event) {
				const tab = (event.target as HTMLElement).closest('[data-tab]')
				if (!tab) return
				event.preventDefault()
				this.active = tab.getAttribute('data-tab') ?? this.active
			},
		},
	})

function indicatorOf(root: HTMLElement): HTMLElement {
	const el = root.querySelector<HTMLElement>('.indicator')
	if (!el) throw new Error('indicator not rendered')
	return el
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
		const canvas = within(canvasElement)
		const sales = canvas.getByRole('link', { name: '販売' })
		const reception = canvas.getByRole('link', { name: '受付' })
		const indicator = indicatorOf(canvasElement)
		await waitFor(() =>
			expect(indicator.getBoundingClientRect().width).toBeCloseTo(
				sales.getBoundingClientRect().width,
				0,
			),
		)

		await userEvent.click(reception)

		await expect(reception).toHaveAttribute('aria-current', 'page')
		const duration = Number.parseFloat(
			getComputedStyle(indicator).transitionDuration,
		)
		if (reduce) {
			await expect(duration).toBe(0)
		} else {
			await expect(duration).toBeCloseTo(0.3, 5)
			await expect(duration).toBeLessThanOrEqual(0.5)
		}
		await waitFor(() =>
			expect(indicator.getBoundingClientRect().left).toBeCloseTo(
				reception.getBoundingClientRect().left,
				0,
			),
		)
	},
} satisfies Story
