import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent } from 'storybook/test'
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

const handleRender =
	(dismissable: boolean, onRequest: () => void): Story['render'] =>
	() =>
		defineAureliaStory({
			template: `
				<sheet-surface dismissable.bind="dismissable" sheet-dismiss-request.trigger="onRequest()">
					<p>Sheet content</p>
				</sheet-surface>
			`,
			props: { dismissable, onRequest },
			register: [SheetSurface],
		})

const asked = fn()

/**
 * The handle of a sheet that can be closed is a button the keyboard and a
 * screen reader reach; activating it asks the sheet around it to close.
 */
export const HandleCloses = {
	render: handleRender(true, asked),
	play: async ({ canvasElement }) => {
		const handle = canvasElement.querySelector('.handle-bar') as HTMLElement
		await expect(handle.tagName).toBe('BUTTON')
		await expect(handle.getAttribute('aria-label')).toBe('閉じる')
		await expect(handle.getBoundingClientRect().height).toBe(48)

		asked.mockClear()
		handle.focus()
		await userEvent.keyboard('{Enter}')
		await expect(asked).toHaveBeenCalledTimes(1)
	},
} satisfies Story

/** A sheet that must be answered keeps its handle as a picture. */
export const HandleIsAPicture = {
	render: handleRender(false, fn()),
	play: async ({ canvasElement }) => {
		const handle = canvasElement.querySelector('.handle-bar') as HTMLElement
		await expect(handle.tagName).toBe('DIV')
		await expect(handle.getAttribute('aria-hidden')).toBe('true')
	},
} satisfies Story
