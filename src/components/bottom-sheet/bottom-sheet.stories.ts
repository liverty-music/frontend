import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { atWidth } from '../../../.storybook/viewport'
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
			description: 'Accessible name for a sheet without a heading.',
		},
		heading: {
			control: 'text',
			description:
				'Heading below the handle bar; it also names the sheet. Empty for none.',
		},
	},
	args: { open: false, dismissable: true, ariaLabel: '詳細', heading: '' },
} satisfies Meta<typeof BottomSheet>

export default meta
type Story = StoryObj<typeof meta>

const template = `
	<bottom-sheet open.bind="open" dismissable.bind="dismissable" aria-label.bind="ariaLabel" heading.bind="heading">
		<div class="story-content">
			<p>東京ドーム — 水道橋駅から徒歩5分</p>
			<button type="button">カレンダーに追加</button>
		</div>
	</bottom-sheet>
`

/** Taps the dimmed area and waits for the sheet to report it has closed, so
 * the background is interactive again for the next story. */
async function dismiss(canvasElement: HTMLElement): Promise<void> {
	let closed = false
	canvasElement.addEventListener('sheet-closed', () => {
		closed = true
	})
	await userEvent.click(
		canvasElement.querySelector<HTMLElement>('.dismiss-zone') as HTMLElement,
	)
	await waitFor(() => expect(closed).toBe(true), { timeout: 2000 })
}

/** The open sheet's dialog, once it has settled at the bottom of the window. */
async function openSheet(canvasElement: HTMLElement): Promise<HTMLElement> {
	const dialog = canvasElement.querySelector<HTMLElement>('dialog')
	await waitFor(() => expect(dialog?.matches(':popover-open')).toBe(true))
	const body = canvasElement.querySelector<HTMLElement>('.sheet-body')
	await waitFor(() =>
		expect(
			Math.abs(
				(body as HTMLElement).getBoundingClientRect().bottom - innerHeight,
			),
		).toBeLessThan(1),
	)
	return dialog as HTMLElement
}

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
		await expect(
			canvas.getByText('東京ドーム — 水道橋駅から徒歩5分'),
		).toBeInTheDocument()
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

// A sheet with a heading: the title-large heading sits right below the 48 px
// handle area, 24 px from both edges, 16 px above the content, and names the
// dialog.
export const WithHeading = {
	render: (args) =>
		defineAureliaStory({ template, props: args, register: [BottomSheet] }),
	args: { open: true, heading: '会場アクセス' },
	play: async ({ canvasElement }) => {
		const dialog = await openSheet(canvasElement)
		const canvas = within(canvasElement)
		const heading = canvas.getByRole('heading', { name: '会場アクセス' })
		const handle = canvasElement.querySelector('.handle-bar') as HTMLElement
		const body = canvasElement.querySelector('.sheet-body') as HTMLElement
		const content = canvasElement.querySelector('.story-content') as HTMLElement
		const headingBox = heading.getBoundingClientRect()
		const bodyBox = body.getBoundingClientRect()

		// The type style, the place below the handle area and the name.
		await expect(heading.tagName).toBe('H2')
		await expect(getComputedStyle(heading).fontSize).toBe('22px')
		await expect(getComputedStyle(heading).lineHeight).toBe('28px')
		await expect(
			headingBox.top - handle.getBoundingClientRect().bottom,
		).toBeCloseTo(0, 0)
		await expect(headingBox.left - bodyBox.left).toBeCloseTo(24, 0)
		await expect(canvas.getByRole('dialog', { name: '会場アクセス' })).toBe(
			dialog,
		)
		await expect(dialog.hasAttribute('aria-label')).toBe(false)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Space below the heading"
		await expect(
			content.getBoundingClientRect().top - headingBox.bottom,
		).toBeCloseTo(16, 0)

		await dismiss(canvasElement)
	},
} satisfies Story

// A sheet without a heading: its content starts right below the handle area,
// and the dialog is still named, by its aria-label.
export const WithoutHeading = {
	render: (args) =>
		defineAureliaStory({ template, props: args, register: [BottomSheet] }),
	args: { open: true, heading: '', ariaLabel: '会場アクセス' },
	play: async ({ canvasElement }) => {
		const dialog = await openSheet(canvasElement)
		const handle = canvasElement.querySelector('.handle-bar') as HTMLElement
		const content = canvasElement.querySelector('.story-content') as HTMLElement

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Sheet without a heading"
		await expect(canvasElement.querySelector('.sheet-body h2')).toBeNull()
		await expect(
			content.getBoundingClientRect().top -
				handle.getBoundingClientRect().bottom,
		).toBeCloseTo(0, 0)
		await expect(
			within(canvasElement).getByRole('dialog', { name: '会場アクセス' }),
		).toBe(dialog)

		await dismiss(canvasElement)
	},
} satisfies Story

// The Material 3 handle and container: a 32 x 4 px fully rounded handle in
// the on-surface-variant role, centred in a 48 px area, on a sheet body with
// the 28 px top corners, surface-container, level 1 and at most 640 px wide.
export const HandleAndBody = {
	render: (args) =>
		defineAureliaStory({ template, props: args, register: [BottomSheet] }),
	args: { open: true, heading: '会場アクセス' },
	play: async ({ canvasElement }) => {
		await openSheet(canvasElement)
		const handleArea = canvasElement.querySelector('.handle-bar') as HTMLElement
		const body = canvasElement.querySelector('.sheet-body') as HTMLElement
		const handle = getComputedStyle(handleArea, '::after')
		const root = getComputedStyle(document.documentElement)
		const role = (name: string) => {
			// A probe resolves the role to the colour the browser computes.
			const probe = document.createElement('span')
			probe.style.color = `var(--md-sys-color-${name})`
			body.append(probe)
			const value = getComputedStyle(probe).color
			probe.remove()
			return value
		}

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Handle bar rendering"
		await expect(handleArea.getBoundingClientRect().height).toBe(48)
		await expect(handle.width).toBe('32px')
		await expect(handle.height).toBe('4px')
		await expect(handle.borderTopLeftRadius).toBe(
			root.getPropertyValue('--md-sys-shape-corner-full').trim(),
		)
		await expect(handle.backgroundColor).toBe(role('on-surface-variant'))

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Sheet body structure"
		const style = getComputedStyle(body)
		await expect(body.tagName).toBe('SECTION')
		await expect(style.borderTopLeftRadius).toBe('28px')
		await expect(style.borderTopRightRadius).toBe('28px')
		await expect(style.backgroundColor).toBe(role('surface-container'))
		await expect(style.boxShadow).not.toBe('none')
		await expect(style.boxShadow).toBe(
			(() => {
				const probe = document.createElement('span')
				probe.style.boxShadow = 'var(--md-sys-elevation-level1)'
				body.append(probe)
				const value = getComputedStyle(probe).boxShadow
				probe.remove()
				return value
			})(),
		)
		await expect(style.maxWidth).toBe('640px')
		await expect(style.overflowY).toBe('auto')
		await expect(style.contain).toBe('layout')
		await expect(Number.parseFloat(style.maxHeight)).toBeCloseTo(
			innerHeight * 0.9,
			0,
		)

		await dismiss(canvasElement)
	},
} satisfies Story

// On a window wider than 640 px the sheet stays 640 px wide, centred.
export const WideWindow = {
	render: (args) =>
		defineAureliaStory({ template, props: args, register: [BottomSheet] }),
	args: { open: true, heading: '会場アクセス' },
	play: async ({ canvasElement }) => {
		await atWidth(1024, async () => {
			await openSheet(canvasElement)
			const box = (
				canvasElement.querySelector('.sheet-body') as HTMLElement
			).getBoundingClientRect()
			await expect(box.width).toBe(640)
			await expect(box.left).toBeCloseTo((innerWidth - 640) / 2, 0)
			await dismiss(canvasElement)
		})
	},
} satisfies Story
