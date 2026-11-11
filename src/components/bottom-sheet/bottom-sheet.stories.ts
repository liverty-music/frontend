import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement } from 'aurelia'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import {
	composite,
	contrast,
	luminance,
	resolveColor,
	WCAG_AA,
} from '../../../.storybook/contrast'
import { swipeVertically } from '../../../.storybook/gestures'
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

// ── Behaviour in a real browser ──────────────────────────────────────────────
//
// The stories below drive the sheet through its open/close lifecycle and check
// what Chromium does with it: the Top Layer, scroll snapping, the
// IntersectionObserver that decides a dismiss, inert and focus. A background
// button stands in for the page behind the sheet.

const behaviourTemplate = `
	<button type="button" id="outside" click.trigger="pressed = pressed + 1">背景のボタン</button>
	<output id="pressed">\${pressed}</output>
	<bottom-sheet open.bind="open" dismissable.bind="dismissable" aria-label.bind="ariaLabel" heading.bind="heading">
		<div class="story-content">
			<p>東京ドーム — 水道橋駅から徒歩5分</p>
			<button type="button" id="first">カレンダーに追加</button>
			<button type="button" id="second">地図を開く</button>
			<button type="button" id="toggle-extra" click.trigger="extra = !extra">道順を切り替える</button>
			<p if.bind="extra" id="extra">会場までの道順</p>
		</div>
	</bottom-sheet>
`

const behaviour: Story['render'] = (args) =>
	defineAureliaStory({
		template: behaviourTemplate,
		props: { ...args, pressed: 0, extra: false },
		register: [BottomSheet],
	})

const vmOf = (root: HTMLElement) =>
	CustomElement.for<BottomSheet>(
		root.querySelector('bottom-sheet') as HTMLElement,
	).viewModel
const dialogOf = (root: HTMLElement) =>
	root.querySelector('dialog') as HTMLDialogElement
const scrollAreaOf = (root: HTMLElement) =>
	root.querySelector('.scroll-area') as HTMLElement
const zoneOf = (root: HTMLElement) =>
	root.querySelector('.dismiss-zone') as HTMLElement
const bodyOf = (root: HTMLElement) =>
	root.querySelector('.sheet-body') as HTMLElement
const outsideOf = (root: HTMLElement) =>
	root.querySelector('#outside') as HTMLButtonElement

/** Counts how often `type` reached `root` (events from the sheet bubble). */
function countEvents(root: HTMLElement, type: string): { n: number } {
	const seen = { n: 0 }
	root.addEventListener(type, () => {
		seen.n += 1
	})
	return seen
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Maximum scrollTop of the sheet's scroll area: the body's height. */
const maxScroll = (area: HTMLElement) => area.scrollHeight - area.clientHeight

/** Jumps the scroll area to `top` with scroll snapping off, so it stays there. */
function jumpTo(area: HTMLElement, top: number): void {
	area.style.scrollSnapType = 'none'
	area.scrollTo({ top, behavior: 'instant' })
}

/** Gives scroll snapping back and settles on the sheet body. */
async function snapBack(area: HTMLElement): Promise<void> {
	area.style.scrollSnapType = ''
	area.scrollTo({ top: maxScroll(area), behavior: 'instant' })
	await pause(50)
}

/** The sheet as a user touching it would have it: the first gesture latched. */
function touch(area: HTMLElement): void {
	area.dispatchEvent(new Event('pointerdown'))
}

/**
 * Wraps `hidePopover` so each call records where the sheet body is at that
 * moment: the share of it still in the viewport, and the scroll position.
 */
function watchHide(root: HTMLElement) {
	const dialog = dialogOf(root)
	const original = dialog.hidePopover.bind(dialog)
	const calls: { visible: number; scrollTop: number }[] = []
	dialog.hidePopover = () => {
		const box = bodyOf(root).getBoundingClientRect()
		calls.push({
			// The share of the body still in the viewport.
			visible: Math.max(0, innerHeight - box.top) / box.height,
			scrollTop: scrollAreaOf(root).scrollTop,
		})
		original()
	}
	return calls
}

/** Closes whatever is open and waits until the page is usable again. */
async function finish(root: HTMLElement): Promise<void> {
	const vm = vmOf(root)
	const dialog = dialogOf(root)
	if (dialog.matches(':popover-open')) {
		vm.open = false
		await waitFor(() => expect(dialog.matches(':popover-open')).toBe(false), {
			timeout: 3000,
		})
	}
	await waitFor(() => expect(outsideOf(root).inert).toBe(false))
}

/**
 * Waits until the sheet rests at the bottom and the scroll that put it there
 * has ended: a close started in between would be finished by that old
 * `scrollend`.
 */
async function ready(root: HTMLElement): Promise<HTMLElement> {
	const dialog = await openSheet(root)
	await pause(300)
	return dialog
}

/** Opens the sheet by its binding and waits until it is ready. */
async function open(root: HTMLElement): Promise<HTMLElement> {
	vmOf(root).open = true
	return ready(root)
}

// The open lifecycle from the parent's side: `open` true shows the popover in
// the Top Layer, makes the page behind inert and moves focus into the sheet,
// where the CSS animation alone leaves the body resting at the bottom; `open`
// false scrolls the sheet to the closed stop and hides the popover only once
// the body has left the viewport.
export const OpenAndCloseByBinding = {
	render: behaviour,
	args: { open: false },
	play: async ({ canvasElement }) => {
		const dialog = dialogOf(canvasElement)
		const area = scrollAreaOf(canvasElement)
		const scrolls: unknown[][] = []
		const scrollTo = area.scrollTo.bind(area) as (...a: unknown[]) => void
		area.scrollTo = ((...a: unknown[]) => {
			scrolls.push(a)
			scrollTo(...a)
		}) as typeof area.scrollTo
		const hides = watchHide(canvasElement)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Basic open/close via bindable"
		await expect(dialog.matches(':popover-open')).toBe(false)
		await open(canvasElement)
		await expect(dialog.matches(':popover-open')).toBe(true)
		await expect(outsideOf(canvasElement).inert).toBe(true)
		await expect(bodyOf(canvasElement).contains(document.activeElement)).toBe(
			true,
		)
		// The body is at the bottom without a scrollTo from the component.
		await expect(scrolls).toHaveLength(0)

		vmOf(canvasElement).open = false
		await waitFor(() => expect(dialog.matches(':popover-open')).toBe(false), {
			timeout: 3000,
		})
		await expect(scrolls[0]).toEqual([expect.objectContaining({ top: 0 })])
		await expect(hides).toHaveLength(1)
		// hidePopover ran only after the body had left the viewport.
		await expect(hides[0].visible).toBeLessThanOrEqual(0.1)
		await expect(hides[0].scrollTop).toBeCloseTo(0, 0)
	},
} satisfies Story

// The sheet's parts and how it is named: a popover="manual" dialog inside the
// host, a scroll container of the window's height with the dismiss zone and the
// body in it, and the backdrop on the popover itself. The dialog element gives
// the dialog role, with no explicit `role` attribute.
export const Structure = {
	render: behaviour,
	args: { open: true },
	play: async ({ canvasElement }) => {
		const dialog = await ready(canvasElement)
		const host = canvasElement.querySelector('bottom-sheet') as HTMLElement
		const area = scrollAreaOf(canvasElement)
		const body = bodyOf(canvasElement)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "DOM structure"
		await expect(dialog.parentElement).toBe(host)
		await expect(dialog.tagName).toBe('DIALOG')
		await expect(dialog.getAttribute('popover')).toBe('manual')
		await expect(dialog.hasAttribute('role')).toBe(false)
		await expect(dialog.matches(':popover-open')).toBe(true)
		await expect(
			within(canvasElement).getByRole('dialog', { name: '詳細' }),
		).toBe(dialog)
		await expect(dialog.getAttribute('aria-modal')).toBe('true')
		await expect(dialog.hasAttribute('aria-label')).toBe(true)
		await expect([...dialog.children]).toEqual([area])
		await expect(area.tagName).toBe('DIV')
		// The sheet itself is the `sheet-surface` host, which has no box of its
		// own: `.sheet-body` is laid out and snaps as the scroll area's child.
		const surface = body.parentElement as HTMLElement
		await expect([...area.children]).toEqual([zoneOf(canvasElement), surface])
		await expect(surface.tagName).toBe('SHEET-SURFACE')
		await expect(getComputedStyle(surface).display).toBe('contents')
		await expect([...surface.children]).toEqual([body])
		await expect(body.tagName).toBe('SECTION')

		const style = getComputedStyle(area)
		await expect(style.overflowY).toBe('auto')
		await expect(style.scrollSnapType).toBe('y mandatory')
		await expect(style.overscrollBehaviorY).toBe('none')
		await expect(style.overscrollBehaviorX).toBe('none')
		// The window's height, in viewport units: it overflows, so it scrolls.
		await expect(area.getBoundingClientRect().height).toBeCloseTo(
			innerHeight,
			0,
		)
		await expect(area.scrollHeight).toBeGreaterThan(area.clientHeight)
		await expect(getComputedStyle(body).contain).toBe('layout')

		// The backdrop belongs to the popover host.
		const backdrop = getComputedStyle(dialog, '::backdrop')
		await expect(backdrop.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
		await expect(backdrop.backdropFilter).toContain('blur')

		await dismiss(canvasElement)
	},
} satisfies Story

// Open: the page behind is inert and Tab cycles inside the sheet, wrapping at
// both ends, while an inert control cannot take focus.
export const InertAndFocusTrap = {
	render: behaviour,
	args: { open: false },
	play: async ({ canvasElement }) => {
		const outside = outsideOf(canvasElement)
		await open(canvasElement)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Background inert and focus trap"
		await expect(outside.inert).toBe(true)
		outside.focus()
		await expect(document.activeElement).not.toBe(outside)

		const first = canvasElement.querySelector('#first') as HTMLElement
		const last = canvasElement.querySelector('#toggle-extra') as HTMLElement
		first.focus()
		await userEvent.tab({ shift: true })
		await expect(document.activeElement).toBe(last)
		await userEvent.tab()
		await expect(document.activeElement).toBe(first)
		for (const _ of [1, 2, 3, 4]) {
			await userEvent.tab()
			await expect(
				dialogOf(canvasElement).contains(document.activeElement),
			).toBe(true)
		}

		await finish(canvasElement)
		await expect(outside.inert).toBe(false)
	},
} satisfies Story

// The page behind comes back as soon as the dismiss is underway, while the
// sheet is still sliding out: the background control takes focus and a press.
export const BackgroundLiveWhileClosing = {
	render: behaviour,
	args: { open: true },
	play: async ({ canvasElement }) => {
		const dialog = await ready(canvasElement)
		const outside = outsideOf(canvasElement)
		await expect(outside.inert).toBe(true)

		let closed = false
		canvasElement.addEventListener('sheet-closed', () => {
			closed = true
		})
		// @spec components/infrastructure/fan/web/global/bottom-sheet "Background interactive during the close animation"
		await userEvent.click(zoneOf(canvasElement))
		await expect(dialog.matches(':popover-open')).toBe(true)
		await expect(outside.inert).toBe(false)
		outside.focus()
		await expect(document.activeElement).toBe(outside)
		outside.click()
		await waitFor(() =>
			expect(canvasElement.querySelector('#pressed')?.textContent).toBe('1'),
		)

		await waitFor(() => expect(closed).toBe(true), { timeout: 3000 })
	},
} satisfies Story

// Content that changes layout inside the body (an element appears, then goes)
// leaves the body flush at the bottom and the scroll area where it was: the
// `contain: layout` guard against Chromium's snap re-evaluation offset.
export const StableWhileContentChanges = {
	render: behaviour,
	args: { open: true },
	play: async ({ canvasElement }) => {
		await ready(canvasElement)
		const area = scrollAreaOf(canvasElement)
		const toggle = canvasElement.querySelector('#toggle-extra') as HTMLElement
		const flush = () =>
			Math.abs(
				bodyOf(canvasElement).getBoundingClientRect().bottom - innerHeight,
			)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Layout stability with dynamic sheet content"
		await expect(getComputedStyle(bodyOf(canvasElement)).contain).toBe('layout')
		for (const shown of [true, false, true]) {
			await userEvent.click(toggle)
			await waitFor(() =>
				expect(canvasElement.querySelector('#extra') !== null).toBe(shown),
			)
			await pause(150)
			await expect(flush()).toBeLessThan(1)
			await expect(area.getBoundingClientRect().top).toBeCloseTo(0, 0)
		}

		await dismiss(canvasElement)
	},
} satisfies Story

// On open the `initial-snap` animation (0.01 s, backwards fill) switches the
// dismiss zone's snap alignment off, so the body is the only snap target and
// the browser lands on it with no script involved; afterwards the zone's
// alignment is back.
export const InitialSnap = {
	render: behaviour,
	args: { open: false },
	play: async ({ canvasElement }) => {
		const area = scrollAreaOf(canvasElement)
		const scrolls: number[] = []
		area.scrollTo = (() => {
			scrolls.push(1)
		}) as typeof area.scrollTo
		const frames: string[] = []
		const raf = window.requestAnimationFrame.bind(window)
		window.requestAnimationFrame = (cb: FrameRequestCallback) => {
			if (new Error().stack?.includes('bottom-sheet')) frames.push('sheet')
			return raf(cb)
		}
		try {
			await open(canvasElement)
		} finally {
			window.requestAnimationFrame = raf
		}

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Initial snap animation"
		const style = getComputedStyle(area)
		await expect(style.animationName).toBe('initial-snap')
		await expect(style.animationDuration).toBe('0.01s')
		await expect(style.animationFillMode).toBe('backwards')
		await expect(scrolls).toHaveLength(0)
		await expect(frames).toHaveLength(0)

		// While the animation runs only the body is a snap target.
		const zone = zoneOf(canvasElement)
		await expect(getComputedStyle(zone).scrollSnapAlign).toBe('start')
		await expect(getComputedStyle(bodyOf(canvasElement)).scrollSnapAlign).toBe(
			'end',
		)
		area.style.animationDuration = '600s'
		await expect(getComputedStyle(zone).scrollSnapAlign).toBe('none')
		await expect(getComputedStyle(bodyOf(canvasElement)).scrollSnapAlign).toBe(
			'end',
		)
		// Once it is over the zone's alignment is restored.
		area.style.animationDuration = ''
		await waitFor(() =>
			expect(getComputedStyle(zone).scrollSnapAlign).toBe('start'),
		)
		await expect(
			Math.abs(
				bodyOf(canvasElement).getBoundingClientRect().bottom - innerHeight,
			),
		).toBeLessThan(1)

		await dismiss(canvasElement)
	},
} satisfies Story

// A dismissable sheet marks its scroll area, its dismiss zone is a snap stop
// above the body, and scrolling up (a swipe down moves the finger down and
// scrollTop falls) brings the zone into view.
export const ScrollSnapDismiss = {
	render: behaviour,
	args: { open: true, dismissable: true },
	play: async ({ canvasElement }) => {
		await ready(canvasElement)
		const area = scrollAreaOf(canvasElement)
		const zone = zoneOf(canvasElement)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Scroll-snap dismiss"
		await expect(area.dataset.dismissable).toBe('true')
		await waitFor(() =>
			expect(getComputedStyle(zone).scrollSnapAlign).toBe('start'),
		)
		await expect(getComputedStyle(area).overscrollBehaviorY).toBe('none')
		const before = zone.getBoundingClientRect().bottom
		await expect(before).toBeLessThanOrEqual(
			bodyOf(canvasElement).getBoundingClientRect().top + 1,
		)
		jumpTo(area, area.scrollTop - 60)
		await waitFor(() =>
			expect(zone.getBoundingClientRect().bottom).toBeCloseTo(before + 60, 0),
		)

		await snapBack(area)
		await dismiss(canvasElement)
	},
} satisfies Story

// A real swipe down: the finger drags the sheet to the dismiss zone, an
// IntersectionObserver on the sheet body sees it leave the viewport, and only
// then the popover is hidden, `open` turns false and `sheet-closed` is sent;
// no `scrollsnapchange` listener is involved.
export const SwipeDownDismiss = {
	render: behaviour,
	args: { open: false, dismissable: true },
	play: async ({ canvasElement }) => {
		const area = scrollAreaOf(canvasElement)
		const dialog = dialogOf(canvasElement)
		const registered: string[] = []
		const add = area.addEventListener.bind(area)
		area.addEventListener = ((type: string, ...rest: unknown[]) => {
			registered.push(type)
			return (add as (...a: unknown[]) => void)(type, ...rest)
		}) as typeof area.addEventListener
		const observed: Element[] = []
		const observe = IntersectionObserver.prototype.observe
		IntersectionObserver.prototype.observe = function (
			this: IntersectionObserver,
			target: Element,
		) {
			observed.push(target)
			observe.call(this, target)
		}
		try {
			await open(canvasElement)
		} finally {
			IntersectionObserver.prototype.observe = observe
		}
		const hides = watchHide(canvasElement)
		const closed = countEvents(canvasElement, 'sheet-closed')

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Responsive swipe-down dismiss detection"
		await expect(observed).toEqual([bodyOf(canvasElement)])
		await expect(registered).not.toContain('scrollsnapchange')
		const swiped = await swipeVertically('.sheet-body', [600])
		if (!swiped) return
		await waitFor(() => expect(dialog.matches(':popover-open')).toBe(false), {
			timeout: 3000,
		})
		await expect(closed.n).toBe(1)
		await expect(vmOf(canvasElement).open).toBe(false)
		await expect(hides).toHaveLength(1)
		await expect(hides[0].visible).toBeLessThanOrEqual(0.1)
	},
} satisfies Story

// No scroll ratio and no `scrollsnapchange` decide a dismiss: a sheet dragged
// part-way and let go stays open, a `pointerup` at any such position closes
// nothing and the scroll area never loses its pointer events.
export const NoRatioHeuristics = {
	render: behaviour,
	args: { open: true },
	play: async ({ canvasElement }) => {
		await ready(canvasElement)
		const area = scrollAreaOf(canvasElement)
		const dialog = dialogOf(canvasElement)
		const closed = countEvents(canvasElement, 'sheet-closed')
		const hides = watchHide(canvasElement)
		touch(area)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Early close on pointerup at dismiss threshold"
		// The old pointerup rule closed below a quarter of the scroll range.
		jumpTo(area, maxScroll(area) * 0.2)
		await pause(150)
		area.dispatchEvent(new Event('pointerup'))
		await pause(400)
		await expect(dialog.matches(':popover-open')).toBe(true)
		await expect(getComputedStyle(area).pointerEvents).not.toBe('none')
		await expect(closed.n).toBe(0)
		await expect(hides).toHaveLength(0)

		await snapBack(area)
		await dismiss(canvasElement)
	},
} satisfies Story

// Scrolling the engine does by itself, or a script does, is not a dismiss: the
// sheet stays open at the dismiss zone until a person has touched it.
export const IgnoresProgrammaticScroll = {
	render: behaviour,
	args: { open: true },
	play: async ({ canvasElement }) => {
		await ready(canvasElement)
		const area = scrollAreaOf(canvasElement)
		const dialog = dialogOf(canvasElement)
		const closed = countEvents(canvasElement, 'sheet-closed')

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Dismiss detection ignores programmatic and initial-snap scroll"
		// Past the initial-snap animation and a settle on the body, untouched.
		await pause(600)
		await expect(dialog.matches(':popover-open')).toBe(true)
		// A script moves the sheet to the dismiss zone: still no dismiss.
		jumpTo(area, 0)
		await pause(500)
		await expect(dialog.matches(':popover-open')).toBe(true)
		await expect(closed.n).toBe(0)
		// A person touches it: the body settles again, then leaves, and that closes.
		touch(area)
		area.style.scrollSnapType = ''
		area.scrollTo({ top: maxScroll(area), behavior: 'instant' })
		await pause(200)
		area.scrollTo({ top: 0, behavior: 'instant' })
		await waitFor(() => expect(closed.n).toBe(1), { timeout: 3000 })
		await expect(dialog.matches(':popover-open')).toBe(false)
	},
} satisfies Story

// Detection rests on the IntersectionObserver alone: opening and swiping away
// register no `scrollsnapchange`, `scrollend` or `pointerup` listener, so an
// engine without `scrollsnapchange` closes the same way.
export const ObserverOnly = {
	render: behaviour,
	args: { open: false },
	play: async ({ canvasElement }) => {
		const area = scrollAreaOf(canvasElement)
		const registered: string[] = []
		for (const target of [area, document] as EventTarget[]) {
			const add = target.addEventListener.bind(target)
			target.addEventListener = ((type: string, ...rest: unknown[]) => {
				registered.push(type)
				return (add as (...a: unknown[]) => void)(type, ...rest)
			}) as typeof target.addEventListener
		}
		const closed = countEvents(canvasElement, 'sheet-closed')
		try {
			await open(canvasElement)
			touch(area)
			jumpTo(area, 0)
			await waitFor(() => expect(closed.n).toBe(1), { timeout: 3000 })
		} finally {
			for (const target of [area, document] as EventTarget[]) {
				delete (target as { addEventListener?: unknown }).addEventListener
			}
		}

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Fallback dismiss detection where scrollsnapchange is unsupported"
		await expect(registered).not.toContain('scrollsnapchange')
		await expect(registered).not.toContain('scrollend')
		await expect(registered).not.toContain('pointerup')
		await expect(dialogOf(canvasElement).matches(':popover-open')).toBe(false)
	},
} satisfies Story

// Dragging down and back before lifting leaves the sheet open, without a hide
// or a `sheet-closed`, and no pointer-events lock on the scroll area; once
// really dismissed, a later upward scroll of the page does not bring it back.
export const NoBounceBack = {
	render: behaviour,
	args: { open: true },
	play: async ({ canvasElement }) => {
		await ready(canvasElement)
		const area = scrollAreaOf(canvasElement)
		const dialog = dialogOf(canvasElement)
		const closed = countEvents(canvasElement, 'sheet-closed')
		const hides = watchHide(canvasElement)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Bounce-back prevention after dismiss-zone snap"
		const dragged = await swipeVertically('.sheet-body', [
			Math.round(maxScroll(area) * 0.4),
			0,
		])
		if (!dragged) return
		await pause(300)
		await expect(dialog.matches(':popover-open')).toBe(true)
		await expect(hides).toHaveLength(0)
		await expect(closed.n).toBe(0)
		await expect(getComputedStyle(area).pointerEvents).not.toBe('none')

		await dismiss(canvasElement)
		window.scrollBy(0, -200)
		await pause(300)
		await expect(dialog.matches(':popover-open')).toBe(false)
	},
} satisfies Story

// A dismiss is the scroll: the popover is hidden when the body has left the
// viewport, and its own transition is an opacity fade only (no `overlay`
// discrete transition) while the backdrop is tied to the scroll position.
export const CloseIsTheScroll = {
	render: behaviour,
	args: { open: true },
	play: async ({ canvasElement }) => {
		const dialog = await ready(canvasElement)
		const hides = watchHide(canvasElement)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Close animation completes within 160ms"
		await userEvent.click(zoneOf(canvasElement))
		await waitFor(() => expect(dialog.matches(':popover-open')).toBe(false), {
			timeout: 3000,
		})
		await expect(hides).toHaveLength(1)
		await expect(hides[0].visible).toBeLessThanOrEqual(0.1)

		const style = getComputedStyle(dialog)
		await expect(style.transitionProperty).toBe('opacity')
		await expect(style.transitionBehavior).toBe('normal')
		await expect(style.transitionProperty).not.toContain('overlay')
		if (CSS.supports('animation-timeline: scroll()')) {
			const backdrop = getComputedStyle(dialog, '::backdrop')
			await expect(backdrop.animationName).toBe('backdrop-fade')
			await expect(backdrop.animationTimeline).toBe('--sheet-scroll')
		}
	},
} satisfies Story

// Tapping the dimmed area closes a dismissable sheet (scroll to the closed
// stop, hide, `open` false, `sheet-closed`); on a sheet that is not
// dismissable the same tap closes nothing.
export const TapOutside = {
	render: behaviour,
	args: { open: true, dismissable: true },
	play: async ({ canvasElement }) => {
		const dialog = await ready(canvasElement)
		const hides = watchHide(canvasElement)
		const closed = countEvents(canvasElement, 'sheet-closed')

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Tap-outside dismiss"
		await userEvent.click(zoneOf(canvasElement))
		await waitFor(() => expect(closed.n).toBe(1), { timeout: 3000 })
		await expect(dialog.matches(':popover-open')).toBe(false)
		await expect(hides).toHaveLength(1)
		await expect(vmOf(canvasElement).open).toBe(false)

		const vm = vmOf(canvasElement)
		vm.dismissable = false
		await open(canvasElement)
		// Not a pointer click: the zone takes no pointer events.
		zoneOf(canvasElement).click()
		await pause(600)
		await expect(dialog.matches(':popover-open')).toBe(true)
		await expect(closed.n).toBe(1)
		await expect(hides).toHaveLength(1)

		await finish(canvasElement)
	},
} satisfies Story

// With motion allowed the backdrop follows the scroll: full at the body, clear
// at the dismiss zone, in between half way. Where the engine cannot tie an
// animation to a scroll position the stylesheet falls back to an opacity
// transition, which the base rule of the backdrop always carries.
export const BackdropFollowsScroll = {
	render: behaviour,
	args: { open: true },
	play: async ({ canvasElement }) => {
		const dialog = await ready(canvasElement)
		const area = scrollAreaOf(canvasElement)
		const opacity = () =>
			Number.parseFloat(getComputedStyle(dialog, '::backdrop').opacity)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Gesture-coupled backdrop fade"
		await expect(CSS.supports('animation-timeline: scroll()')).toBe(true)
		await expect(opacity()).toBeCloseTo(1, 1)
		jumpTo(area, maxScroll(area) / 2)
		await waitFor(() => expect(opacity()).toBeCloseTo(0.5, 1))
		jumpTo(area, 0)
		await waitFor(() => expect(opacity()).toBeCloseTo(0, 1))
		await snapBack(area)

		// The rules: the scroll-driven animation only inside an
		// `@supports (animation-timeline: scroll())` block, the transition fallback
		// outside it.
		const found = { timeline: false, fallback: false, leaked: false }
		const visit = (rules: CSSRuleList, supported: boolean): void => {
			for (const rule of Array.from(rules)) {
				const inner = rule as CSSGroupingRule
				const isSupports =
					rule instanceof CSSSupportsRule &&
					rule.conditionText.includes('animation-timeline')
				if (
					rule instanceof CSSStyleRule &&
					rule.selectorText.includes('::backdrop')
				) {
					const timeline = rule.style.getPropertyValue('animation-timeline')
					if (timeline) {
						found.timeline = true
						if (!supported) found.leaked = true
					}
					if (rule.style.getPropertyValue('transition').includes('opacity')) {
						if (!supported) found.fallback = true
					}
				}
				if (inner.cssRules) visit(inner.cssRules, supported || isSupports)
			}
		}
		for (const sheet of Array.from(document.styleSheets)) {
			try {
				visit(sheet.cssRules, false)
			} catch {
				// A cross-origin sheet cannot be read.
			}
		}
		await expect(found.timeline).toBe(true)
		await expect(found.leaked).toBe(false)
		await expect(found.fallback).toBe(true)

		await dismiss(canvasElement)
	},
} satisfies Story

// A sheet that is not dismissable keeps the page inert for its whole life:
// Escape and a tap on the dimmed area close nothing, the dismiss zone stays in
// the DOM hidden from assistive technology with no snap alignment and no
// pointer events, and the body is the one snap target.
export const NotDismissable = {
	render: behaviour,
	args: { open: false, dismissable: false },
	play: async ({ canvasElement }) => {
		const dialog = dialogOf(canvasElement)
		await open(canvasElement)
		const area = scrollAreaOf(canvasElement)
		const zone = zoneOf(canvasElement)
		const closed = countEvents(canvasElement, 'sheet-closed')
		const scrolls: number[] = []
		area.scrollTo = (() => {
			scrolls.push(1)
		}) as typeof area.scrollTo

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Non-dismissable mode"
		await expect(dialog.matches(':popover-open')).toBe(true)
		await expect(outsideOf(canvasElement).inert).toBe(true)
		await expect(area.dataset.dismissable).toBe('false')
		await expect(zone.getAttribute('aria-hidden')).toBe('true')
		await expect(getComputedStyle(zone).scrollSnapAlign).toBe('none')
		await expect(getComputedStyle(zone).pointerEvents).toBe('none')
		await expect(getComputedStyle(bodyOf(canvasElement)).scrollSnapAlign).toBe(
			'end',
		)
		await userEvent.keyboard('{Escape}')
		// Not a pointer click: the zone takes no pointer events.
		zone.click()
		await pause(600)
		await expect(dialog.matches(':popover-open')).toBe(true)
		await expect(outsideOf(canvasElement).inert).toBe(true)
		await expect(scrolls).toHaveLength(0)
		await expect(closed.n).toBe(0)

		delete (area as { scrollTo?: unknown }).scrollTo
		await finish(canvasElement)
	},
} satisfies Story

// Content put inside <bottom-sheet> is projected into the sheet body, below the
// handle bar.
export const SlottedContent = {
	render: behaviour,
	args: { open: true },
	play: async ({ canvasElement }) => {
		await ready(canvasElement)
		const content = canvasElement.querySelector('.story-content') as HTMLElement
		const handle = canvasElement.querySelector('.handle-bar') as HTMLElement

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Slotted content"
		await expect(bodyOf(canvasElement).contains(content)).toBe(true)
		await expect(content.closest('bottom-sheet')).not.toBeNull()
		await expect(
			handle.compareDocumentPosition(content) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
		await expect(content.getBoundingClientRect().top).toBeGreaterThanOrEqual(
			handle.getBoundingClientRect().bottom - 1,
		)

		await dismiss(canvasElement)
	},
} satisfies Story

// Opening moves focus into the sheet; closing gives it back to the control that
// had it, and the sheet pushes no history entry of its own.
export const FocusAndHistory = {
	render: behaviour,
	args: { open: false },
	play: async ({ canvasElement }) => {
		const outside = outsideOf(canvasElement)
		outside.focus()
		await expect(document.activeElement).toBe(outside)
		const length = history.length
		const pushed: unknown[] = []
		const push = history.pushState.bind(history)
		history.pushState = (...args: Parameters<History['pushState']>) => {
			pushed.push(args)
			push(...args)
		}
		try {
			await open(canvasElement)

			// @spec components/infrastructure/fan/web/global/bottom-sheet "Focus management"
			await expect(bodyOf(canvasElement).contains(document.activeElement)).toBe(
				true,
			)
			// @spec components/infrastructure/fan/web/global/bottom-sheet "History integration"
			await expect(history.length).toBe(length)
			await expect(pushed).toHaveLength(0)

			await finish(canvasElement)
			// @spec components/infrastructure/fan/web/global/bottom-sheet "Focus management"
			await expect(document.activeElement).toBe(outside)
			// @spec components/infrastructure/fan/web/global/bottom-sheet "History integration"
			await expect(history.length).toBe(length)
			await expect(pushed).toHaveLength(0)
		} finally {
			history.pushState = push
		}
	},
} satisfies Story

// Motion preferences: with motion allowed the dismiss is a smooth scroll that
// is still under way when the tap returns; with motion reduced it is a jump
// and the sheet is gone by then, and the backdrop's fallback transition is
// near-instant. Runs in both browser contexts.
export const MotionPreference = {
	tags: ['reduced-motion'],
	render: behaviour,
	args: { open: true },
	play: async ({ canvasElement, globals }) => {
		const dialog = await ready(canvasElement)
		const area = scrollAreaOf(canvasElement)
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		await expect(reduced).toBe(globals.reducedMotion)
		const seconds = (value: string) => Number.parseFloat(value)
		const closed = countEvents(canvasElement, 'sheet-closed')

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Close animation completes within 160ms (legacy duration removed)"
		// @spec components/infrastructure/fan/web/global/bottom-sheet "Reduced motion"
		await userEvent.click(zoneOf(canvasElement))
		if (reduced) {
			await expect(getComputedStyle(area).scrollBehavior).toBe('auto')
			await expect(dialog.matches(':popover-open')).toBe(false)
			await expect(closed.n).toBe(1)
			await expect(
				seconds(getComputedStyle(dialog).transitionDuration),
			).toBeLessThan(0.001)
			await expect(
				seconds(getComputedStyle(dialog, '::backdrop').transitionDuration),
			).toBeLessThan(0.001)
		} else {
			await expect(getComputedStyle(area).scrollBehavior).toBe('smooth')
			await expect(dialog.matches(':popover-open')).toBe(true)
			await waitFor(() => expect(closed.n).toBe(1), { timeout: 3000 })
			await expect(
				seconds(getComputedStyle(dialog).transitionDuration),
			).toBeCloseTo(0.16, 2)
		}
	},
} satisfies Story

// Taking the sheet out of the page while it is open undoes what it set up:
// the popover is hidden, the page is no longer inert, and the dismiss zone's
// click, the Escape listener and the observer are gone.
export const DetachCleanup = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<button type="button" id="outside" click.trigger="pressed = pressed + 1">背景のボタン</button>
				<button type="button" id="remove" click.trigger="mounted = false">外す</button>
				<bottom-sheet if.bind="mounted" open.bind="open" aria-label="詳細">
					<p>東京ドーム — 水道橋駅から徒歩5分</p>
				</bottom-sheet>
			`,
			props: { ...args, pressed: 0, mounted: true },
			register: [BottomSheet],
		}),
	args: { open: true },
	play: async ({ canvasElement }) => {
		const dialog = await ready(canvasElement)
		const area = scrollAreaOf(canvasElement)
		const zone = zoneOf(canvasElement)
		const host = canvasElement.querySelector('bottom-sheet') as HTMLElement
		const outside = outsideOf(canvasElement)
		await expect(outside.inert).toBe(true)

		const hides = watchHide(canvasElement)
		const scrolls: number[] = []
		area.scrollTo = (() => {
			scrolls.push(1)
		}) as typeof area.scrollTo
		const closed = countEvents(canvasElement, 'sheet-closed')
		let disconnects = 0
		const disconnect = IntersectionObserver.prototype.disconnect
		IntersectionObserver.prototype.disconnect = function (
			this: IntersectionObserver,
		) {
			disconnects += 1
			disconnect.call(this)
		}
		try {
			;(canvasElement.querySelector('#remove') as HTMLElement).click()
			await waitFor(() =>
				expect(canvasElement.querySelector('bottom-sheet')).toBeNull(),
			)
		} finally {
			IntersectionObserver.prototype.disconnect = disconnect
		}

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Detach cleanup"
		await expect(host.isConnected).toBe(false)
		await expect(hides.length).toBeGreaterThanOrEqual(1)
		await expect(outside.inert).toBe(false)
		await expect(disconnects).toBeGreaterThanOrEqual(1)
		// The dismiss zone no longer reacts to a tap, nor the document to Escape.
		zone.click()
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
		await pause(200)
		await expect(scrolls).toHaveLength(0)
		await expect(closed.n).toBe(0)
		await expect(dialog.matches(':popover-open')).toBe(false)
	},
} satisfies Story

// A sheet is promoted to the Top Layer, where it inherits from <html> and not
// from <body>: its text takes the on-surface role (near-white) from the global
// rule, and reads against the sheet's dark surface-container.
export const TextOnDarkSurface = {
	render: behaviour,
	args: { open: true, heading: '会場アクセス' },
	play: async ({ canvasElement }) => {
		const dialog = await ready(canvasElement)
		const onSurface = resolveColor(
			canvasElement,
			'var(--md-sys-color-on-surface)',
		)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Bottom-sheet text is readable on dark background"
		const texts = [
			dialog,
			canvasElement.querySelector('.sheet-heading'),
			canvasElement.querySelector('.story-content p'),
		] as HTMLElement[]
		for (const el of texts) {
			await expect(getComputedStyle(el).color).toBe(onSurface)
		}
		const text = composite(onSurface)
		const surface = composite(
			resolveColor(canvasElement, 'var(--md-sys-color-surface-container)'),
		)
		await expect(luminance(text)).toBeGreaterThan(0.8)
		await expect(luminance(surface)).toBeLessThan(0.05)
		await expect(
			composite(getComputedStyle(bodyOf(canvasElement)).backgroundColor),
		).toEqual(surface)
		await expect(contrast(text, surface)).toBeGreaterThanOrEqual(WCAG_AA)

		await dismiss(canvasElement)
	},
} satisfies Story

// The global rule that gives popovers and dialogs their text colour is wrapped
// in :where(), so it counts for no specificity: the lowest-specificity rule
// that targets such an element, a bare type selector in the same layer, wins
// over it.
export const GlobalTextRuleHasNoSpecificity = {
	render: behaviour,
	args: { open: false },
	play: async ({ canvasElement }) => {
		const rules: string[] = []
		const visit = (list: CSSRuleList): void => {
			for (const rule of Array.from(list)) {
				if (
					rule instanceof CSSStyleRule &&
					rule.selectorText.includes('[popover]') &&
					rule.style.getPropertyValue('color') ===
						'var(--md-sys-color-on-surface)'
				) {
					rules.push(rule.selectorText)
				}
				const group = rule as CSSGroupingRule
				if (group.cssRules) visit(group.cssRules)
			}
		}
		for (const sheet of Array.from(document.styleSheets)) {
			try {
				visit(sheet.cssRules)
			} catch {
				// A cross-origin sheet cannot be read.
			}
		}

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Global rule uses zero specificity"
		await expect(rules.length).toBeGreaterThan(0)
		for (const selector of rules) {
			await expect(selector).toMatch(/^:where\(.*\)$/)
		}

		const override = document.createElement('style')
		override.textContent =
			'@layer global { dialog.probe { color: rgb(255 0 0) } }'
		document.head.append(override)
		const probe = document.createElement('dialog')
		probe.className = 'probe'
		probe.setAttribute('popover', 'manual')
		canvasElement.append(probe)
		try {
			probe.showPopover()
			await expect(getComputedStyle(probe).color).toBe('rgb(255, 0, 0)')
		} finally {
			probe.remove()
			override.remove()
		}
	},
} satisfies Story

// Who closed the sheet decides what it reports. A person closing it (Escape, a
// tap on the dimmed area, a swipe) gets `sheet-closed` and `open` false; the
// parent turning `open` off itself, as the consumer does on the Android back
// gesture's `popstate`, gets no `sheet-closed` (it would loop) and one
// `sheet-hidden` once the sheet has finished closing.
export const CloseEvents = {
	render: behaviour,
	args: { open: false, dismissable: true },
	play: async ({ canvasElement }) => {
		const vm = vmOf(canvasElement)
		const dialog = dialogOf(canvasElement)
		const closed = countEvents(canvasElement, 'sheet-closed')
		const hidden = countEvents(canvasElement, 'sheet-hidden')
		// What the sheet looked like when `sheet-hidden` arrived.
		const atHidden: { popoverOpen: boolean; inert: boolean }[] = []
		canvasElement.addEventListener('sheet-hidden', () => {
			atHidden.push({
				popoverOpen: dialog.matches(':popover-open'),
				inert: outsideOf(canvasElement).inert,
			})
		})
		const hides = watchHide(canvasElement)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Dismissable mode with close-request dismiss (ESC / Android back)"
		// @spec components/infrastructure/fan/web/global/bottom-sheet "Sheet closed event"
		// Escape: the scroll-to-closed-stop dismiss, `open` false, `sheet-closed`.
		await open(canvasElement)
		await userEvent.keyboard('{Escape}')
		await waitFor(() => expect(closed.n).toBe(1), { timeout: 3000 })
		await expect(dialog.matches(':popover-open')).toBe(false)
		await expect(vm.open).toBe(false)
		await expect(hides).toHaveLength(1)

		// A tap on the dimmed area.
		await open(canvasElement)
		await userEvent.click(zoneOf(canvasElement))
		await waitFor(() => expect(closed.n).toBe(2), { timeout: 3000 })
		await expect(vm.open).toBe(false)

		// A swipe (only where the browser can send touch input).
		await open(canvasElement)
		if (await swipeVertically('.sheet-body', [600])) {
			await waitFor(() => expect(closed.n).toBe(3), { timeout: 3000 })
			await expect(vm.open).toBe(false)
		} else {
			await finish(canvasElement)
			closed.n = 3
		}
		await expect(hidden.n).toBe(3)

		// The consumer closes it on `popstate`: the programmatic path.
		const onPopState = () => {
			vm.open = false
		}
		window.addEventListener('popstate', onPopState)
		try {
			await open(canvasElement)
			window.dispatchEvent(new PopStateEvent('popstate'))
			await waitFor(() => expect(hidden.n).toBe(4), { timeout: 3000 })
		} finally {
			window.removeEventListener('popstate', onPopState)
		}
		await pause(300)
		await expect(closed.n).toBe(3)
		await expect(hidden.n).toBe(4)
		// By then the sheet had finished closing: hidden, page live again.
		await expect(atHidden[3]).toEqual({ popoverOpen: false, inert: false })
		await expect(dialog.matches(':popover-open')).toBe(false)
	},
} satisfies Story
