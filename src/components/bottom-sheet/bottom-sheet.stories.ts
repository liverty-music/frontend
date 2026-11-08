import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { BottomSheet } from './bottom-sheet'

const meta = {
	title: 'Components/BottomSheet',
	component: BottomSheet,
	argTypes: {
		open: { control: 'boolean', description: 'Shows/dismisses the sheet.' },
		dismissable: {
			control: 'boolean',
			description:
				'Whether tapping the dimmed area / pressing Escape closes it.',
		},
		ariaLabel: {
			control: 'text',
			description: 'Accessible name for the sheet.',
		},
	},
	args: { open: false, dismissable: true, ariaLabel: '詳細' },
} satisfies Meta<typeof BottomSheet>

export default meta
type Story = StoryObj<typeof meta>

const template = `
	<bottom-sheet open.bind="open" dismissable.bind="dismissable" aria-label.bind="ariaLabel">
		<h2>会場アクセス</h2>
		<p>東京ドーム — 水道橋駅から徒歩5分</p>
		<button type="button">カレンダーに追加</button>
	</bottom-sheet>
`

// Closed state: the sheet is in the DOM but not shown; nothing is inerted.
export const Closed = {
	render: (args) =>
		defineAureliaStory({ template, props: args, register: [BottomSheet] }),
	args: { open: false },
	play: async ({ canvasElement }) => {
		const dialog = canvasElement.querySelector('dialog')
		await expect(dialog).toBeTruthy()
		await expect(dialog?.matches(':popover-open')).toBe(false)
	},
} satisfies Story

// Open → interact → dismiss. The sheet opens (making the background inert),
// projects its content, then the dimmed dismiss zone is tapped, which scrolls it
// closed and emits `sheet-closed`. Closing at the end restores the background so
// the shared browser page stays interactive for the next story (leaving an open
// sheet inerts the test harness and closes the page).
export const OpenThenDismiss = {
	render: (args) =>
		defineAureliaStory({ template, props: args, register: [BottomSheet] }),
	args: { open: true, dismissable: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByText('会場アクセス')).toBeInTheDocument()
		await expect(
			canvas.getByRole('button', { name: 'カレンダーに追加' }),
		).toBeInTheDocument()

		let closed = false
		canvasElement.addEventListener('sheet-closed', () => {
			closed = true
		})
		const dismissZone =
			canvasElement.querySelector<HTMLElement>('.dismiss-zone')
		await expect(dismissZone).toBeTruthy()
		await userEvent.click(dismissZone as HTMLElement)
		await waitFor(() => expect(closed).toBe(true), { timeout: 2000 })
	},
} satisfies Story

// The sheet's top corners take the extra-large corner shape (28 px), and only
// the top edge is rounded, also when the page reads right to left. The
// logical properties are what makes that hold for any rounding; a physical
// longhand such as `border-top-left-radius` is rejected by stylelint
// (`property-layout-mappings`). Closes the sheet at the end, as above.
export const RoundedTopCorners = {
	render: (args) =>
		defineAureliaStory({
			template: `<div dir="rtl">${template}</div>`,
			props: args,
			register: [BottomSheet],
		}),
	args: { open: true, dismissable: true },
	play: async ({ canvasElement }) => {
		const body = canvasElement.querySelector<HTMLElement>('.sheet-body')
		await expect(body).toBeTruthy()
		const style = getComputedStyle(body as HTMLElement)
		const extraLarge = getComputedStyle(document.documentElement)
			.getPropertyValue('--md-sys-shape-corner-extra-large')
			.trim()

		// @spec components/infrastructure/fan/web/global/design-tokens "Radius matches component size"
		await expect(extraLarge).toBe('28px')
		await expect(style.borderStartStartRadius).toBe(extraLarge)

		// @spec components/infrastructure/fan/web/global/design-tokens "Directional rounding is RTL-safe"
		await expect(style.direction).toBe('rtl')
		await expect(style.borderTopRightRadius).toBe(extraLarge)
		await expect(style.borderTopLeftRadius).toBe(extraLarge)
		await expect(style.borderBottomRightRadius).toBe('0px')
		await expect(style.borderBottomLeftRadius).toBe('0px')

		let closed = false
		canvasElement.addEventListener('sheet-closed', () => {
			closed = true
		})
		await userEvent.click(
			canvasElement.querySelector<HTMLElement>('.dismiss-zone') as HTMLElement,
		)
		await waitFor(() => expect(closed).toBe(true), { timeout: 2000 })
	},
} satisfies Story
