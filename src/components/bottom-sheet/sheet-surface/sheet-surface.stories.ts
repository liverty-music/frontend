import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { SheetSurface } from './sheet-surface'

const meta = {
	title: 'Components/SheetSurface',
	component: SheetSurface,
} satisfies Meta<typeof SheetSurface>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The sheet outside its popover: drag handle, optional heading with an
 * action beside it, and content. Its colour is the bottom sheet's
 * (bottom-sheet stories show it in place).
 */
const render =
	(heading: string): Story['render'] =>
	() =>
		defineAureliaStory({
			template: `
				<sheet-surface heading.bind="heading" heading-id="story-heading">
					<button au-slot="heading-action" type="button">Clear</button>
					<p>Sheet content</p>
				</sheet-surface>
			`,
			props: { heading },
			register: [SheetSurface],
		})

/** A 48 px handle area, then the heading row 24 px from the edges. */
export const WithHeading = {
	render: render('Area and period'),
	play: async ({ canvasElement }) => {
		const handle = canvasElement.querySelector('.handle-bar') as HTMLElement
		await expect(handle.getBoundingClientRect().height).toBe(48)
		const row = canvasElement.querySelector('.sheet-heading-row') as HTMLElement
		await expect(getComputedStyle(row).paddingInlineStart).toBe('24px')
		await expect(row.querySelector('h2')?.id).toBe('story-heading')
		await expect(row.querySelector('button')?.textContent).toBe('Clear')
	},
} satisfies Story

/** No heading: the content starts right below the handle area. */
export const WithoutHeading = {
	render: render(''),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('.sheet-heading-row')).toBeNull()
		await expect(canvasElement.querySelector('.sheet-body p')).not.toBeNull()
	},
} satisfies Story
