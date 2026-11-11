import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { BottomNavTab } from './bottom-nav-tab'

const meta = {
	title: 'Components/BottomNavTab',
	component: BottomNavTab,
} satisfies Meta<typeof BottomNavTab>

export default meta
type Story = StoryObj<typeof meta>

const TAB = {
	id: 'dashboard',
	path: ['dashboard'],
	isActive: false,
	data: { icon: 'home', labelKey: 'nav.home' },
}

/**
 * One tab in a 90 x 64 px cell, as the bar lays it out. The selected tab's
 * state-layer fill is the bar's (bottom-nav-bar stories).
 */
const render =
	(active: boolean): Story['render'] =>
	() =>
		defineAureliaStory({
			template: `
				<nav style="display: grid; grid-template-columns: 90px; block-size: 64px">
					<bottom-nav-tab tab.bind="tab" active.bind="active"></bottom-nav-tab>
				</nav>
			`,
			props: { tab: TAB, active },
			register: [BottomNavTab],
		})

const tab = (root: HTMLElement) =>
	root.querySelector('.nav-tab') as HTMLAnchorElement

/** Not selected: on-surface-variant, no accent bar, the plain label weight. */
export const Unselected = {
	render: render(false),
	play: async ({ canvasElement }) => {
		const link = tab(canvasElement)
		await expect(link.getBoundingClientRect().height).toBe(64)
		await expect(getComputedStyle(link, '::after').content).toBe('none')
		const label = link.querySelector('.nav-label') as Element
		await expect(getComputedStyle(label).fontWeight).toBe('500')
	},
} satisfies Story

/** Selected: brand accent, a 2 px accent bar on top, the emphasized label. */
export const Selected = {
	render: render(true),
	play: async ({ canvasElement }) => {
		const link = tab(canvasElement)
		await expect(link.dataset.active).toBe('true')
		await expect(getComputedStyle(link, '::after').height).toBe('2px')
		const label = link.querySelector('.nav-label') as Element
		await expect(getComputedStyle(label).fontWeight).toBe('600')
	},
} satisfies Story
