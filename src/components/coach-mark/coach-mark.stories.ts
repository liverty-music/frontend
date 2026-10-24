import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { CoachMark } from './coach-mark'

const MESSAGE = 'カードをタップして、チケットや会場をチェック'

const meta = {
	title: 'Components/CoachMark',
	component: CoachMark,
	tags: ['test', 'autodocs'],
	argTypes: {
		message: { control: 'text', description: 'Coaching tip copy.' },
		active: {
			control: 'boolean',
			description: 'Activates the spotlight and anchors it to the target.',
		},
		targetSelector: {
			control: 'text',
			description: 'CSS selector of the element the spotlight highlights.',
		},
	},
	args: {
		message: MESSAGE,
		active: true,
		targetSelector: '#coach-target',
	},
} satisfies Meta<typeof CoachMark>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A page with a fixed on-screen target the coach mark resolves and highlights,
 * and a second control under the dimmed area to show that taps there reach the
 * page. `target` is the target's markup; `host` is extra attributes for the
 * `<coach-mark>` element (e.g. the corner radius a screen gives).
 */
function page({
	target = `<button id="coach-target" type="button"
		style="position: fixed; inset-block-start: 80px; inset-inline-start: 80px;">
		ライブカード
	</button>`,
	host = '',
} = {}): string {
	return `
	<div lang="ja">
		${target}
		<button id="page-under" type="button"
			style="position: fixed; inset-block-start: 320px; inset-inline-start: 24px;">
			ページのボタン
		</button>
		<coach-mark ${host}
			target-selector.bind="targetSelector"
			message.bind="message"
			active.bind="active">
		</coach-mark>
	</div>
	`
}

const render =
	(template = page()): Story['render'] =>
	(args) =>
		defineAureliaStory({ template, props: args, register: [CoachMark] })

/** Wait for the target to resolve; the pulse is cancelled so boxes are exact. */
async function shownSpotlight(root: HTMLElement): Promise<HTMLElement> {
	const spot = await waitFor(() => {
		const el = root.querySelector<HTMLElement>('.visual-spotlight')
		if (!el) throw new Error('spotlight not shown yet')
		return el
	})
	for (const animation of spot.getAnimations()) animation.cancel()
	return spot
}

function byId(root: HTMLElement, id: string): HTMLElement {
	const el = root.querySelector<HTMLElement>(`#${id}`)
	if (!el) throw new Error(`#${id} missing`)
	return el
}

function center(el: Element): { x: number; y: number } {
	const r = el.getBoundingClientRect()
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** The element a real tap at the centre of `el` would land on. */
function hitAt(el: Element): Element | null {
	const { x, y } = center(el)
	return document.elementFromPoint(x, y)
}

// Active: the spotlight overlay and its tooltip render once the target resolves.
export const Active = {
	render: render(),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		// @spec components/infrastructure/fan/web/global/coach-mark "Spotlight renders for active coach mark"
		await shownSpotlight(canvasElement)
		await expect(canvas.getByText(MESSAGE)).toBeInTheDocument()
		await expect(
			canvas.getByRole('tooltip', { name: 'Onboarding tip' }),
		).toBeInTheDocument()
	},
} satisfies Story

// Inactive: no overlay is rendered.
export const Inactive = {
	render: render(),
	args: { active: false },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('[role="tooltip"]')).toBeNull()
	},
} satisfies Story

// The dim layer: 70% black everywhere but a rounded cutout over the target,
// and it never takes a tap.
export const Spotlight = {
	render: render(),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/coach-mark "Spotlight renders with rounded cutout over target"
		const spot = await shownSpotlight(canvasElement)
		const style = getComputedStyle(spot)
		// The dim is a 100vmax spread of 70% black around the cutout…
		await expect(style.boxShadow).toMatch(/0\.7\)/)
		await expect(style.boxShadow).not.toMatch(/inset/)
		// …so inside the cutout nothing is painted over the target…
		await expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
		// …and its corners are rounded.
		await expect(style.borderTopLeftRadius).toBe('12px')
		// A tap on the dimmed area lands on the page element beneath it.
		const under = byId(canvasElement, 'page-under')
		await expect(hitAt(under)).toBe(under)
	},
} satisfies Story

// The screen gives the corner radius for its target; none given → 12px.
export const CircularTarget = {
	render: render(page({ host: 'style="--spotlight-radius: 50%"' })),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/coach-mark "Spotlight shape adapts per step"
		const spot = await shownSpotlight(canvasElement)
		await expect(getComputedStyle(spot).borderTopLeftRadius).toBe('50%')
		await expect(getComputedStyle(spot).borderBottomRightRadius).toBe('50%')
	},
} satisfies Story

export const CutoutPadding = {
	render: render(),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/coach-mark "Spotlight cutout has padding around target"
		const spot = (await shownSpotlight(canvasElement)).getBoundingClientRect()
		const target = byId(canvasElement, 'coach-target').getBoundingClientRect()
		await expect(spot.left).toBeCloseTo(target.left - 8, 0)
		await expect(spot.top).toBeCloseTo(target.top - 8, 0)
		await expect(spot.right).toBeCloseTo(target.right + 8, 0)
		await expect(spot.bottom).toBeCloseTo(target.bottom + 8, 0)
	},
} satisfies Story

// A highlighted link: the tap lands on the coach mark's interceptor, which
// performs the link's own navigation and closes the coach mark.
export const LinkTarget = {
	render: render(
		page({
			target: `<a id="coach-target" href="#coach-link-followed"
				style="position: fixed; inset-block-start: 80px; inset-inline-start: 80px;">
				ホーム
			</a>`,
		}),
	),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/coach-mark "Nav tab tap through spotlight delegates to href"
		await shownSpotlight(canvasElement)
		const link = byId(canvasElement, 'coach-target')
		const hit = hitAt(link)
		await expect(hit).toHaveClass('target-interceptor')
		// Navigating the test frame would end the run, so a last window listener
		// records what the browser was about to do and then stops it: a click
		// on the link whose default action (following the href) nobody cancelled
		// is exactly what a direct tap on the link produces.
		const clicks: { target: EventTarget | null; navigates: boolean }[] = []
		const record = (e: MouseEvent): void => {
			clicks.push({ target: e.target, navigates: !e.defaultPrevented })
			e.preventDefault()
		}
		window.addEventListener('click', record)
		try {
			await userEvent.click(hit as Element)
		} finally {
			window.removeEventListener('click', record)
		}
		await expect(clicks.filter((c) => c.target === link)).toEqual([
			{ target: link, navigates: true },
		])
		await waitFor(() =>
			expect(canvasElement.querySelector('.coach-mark-overlay')).toBeNull(),
		)
	},
} satisfies Story

export const OutsideTap = {
	render: render(),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/coach-mark "Off-target tap light-dismisses without blocking the page"
		await shownSpotlight(canvasElement)
		const rootOverflow = getComputedStyle(document.documentElement).overflow
		const bodyOverflow = getComputedStyle(document.body).overflow
		const under = byId(canvasElement, 'page-under')
		let pageTaps = 0
		under.addEventListener('click', () => {
			pageTaps++
		})
		// The tap lands on the page control beneath the dim, not on the overlay.
		await expect(hitAt(under)).toBe(under)
		await userEvent.click(under)
		await expect(pageTaps).toBe(1)
		await waitFor(() =>
			expect(canvasElement.querySelector('.coach-mark-overlay')).toBeNull(),
		)
		// The coach mark never touched page scrolling.
		await expect(getComputedStyle(document.documentElement).overflow).toBe(
			rootOverflow,
		)
		await expect(getComputedStyle(document.body).overflow).toBe(bodyOverflow)
	},
} satisfies Story

// While shown, the page around the target stays interactive and scrollable.
export const NonBlocking = {
	render: render(
		page({
			target: `<button id="coach-target" type="button"
				style="position: fixed; inset-block-start: 80px; inset-inline-start: 80px;">
				ライブカード
			</button>
			<div id="page-scroll" tabindex="0" aria-label="スクロール領域"
				style="position: fixed; inset-block-start: 400px; inset-inline-start: 24px; inline-size: 160px; block-size: 80px; overflow: auto;">
				<div style="block-size: 400px;">長いページ</div>
			</div>`,
		}),
	),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/coach-mark "Coach mark does not block the rest of the page"
		const rootBefore = getComputedStyle(document.documentElement).overflow
		const bodyBefore = getComputedStyle(document.body).overflow
		const spot = await shownSpotlight(canvasElement)
		const overlay = canvasElement.querySelector('.coach-mark-overlay')
		await expect(getComputedStyle(overlay as Element).pointerEvents).toBe(
			'none',
		)
		await expect(getComputedStyle(spot).pointerEvents).toBe('none')
		// Controls outside the target receive the tap…
		const under = byId(canvasElement, 'page-under')
		await expect(hitAt(under)).toBe(under)
		// …and so does a scroll area, so a swipe or wheel there scrolls it.
		const scroller = byId(canvasElement, 'page-scroll')
		await expect(scroller.contains(hitAt(scroller))).toBe(true)
		// Page scroll is not locked while the coach mark is shown.
		await expect(getComputedStyle(document.documentElement).overflow).toBe(
			rootBefore,
		)
		await expect(getComputedStyle(document.body).overflow).toBe(bodyBefore)
	},
} satisfies Story

export const MessageBelowTarget = {
	render: render(),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/coach-mark "Tooltip appears below target"
		await shownSpotlight(canvasElement)
		const tip = within(canvasElement)
			.getByRole('tooltip')
			.getBoundingClientRect()
		const target = byId(canvasElement, 'coach-target').getBoundingClientRect()
		await expect(tip.top).toBeGreaterThanOrEqual(target.bottom - 0.5)
		await expect(tip.top - target.bottom).toBeLessThan(32)
		// Horizontally it sits under the target, not off to one side.
		await expect(tip.left).toBeLessThan(target.right)
		await expect(tip.right).toBeGreaterThan(target.left)
	},
} satisfies Story

// A target at the bottom of the viewport leaves no room below it.
export const MessageAboveTarget = {
	render: render(
		page({
			target: `<button id="coach-target" type="button"
				style="position: fixed; inset-block-end: 16px; inset-inline-start: 80px;">
				ライブカード
			</button>`,
		}),
	),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/coach-mark "Message flips above the target"
		await shownSpotlight(canvasElement)
		const tip = within(canvasElement)
			.getByRole('tooltip')
			.getBoundingClientRect()
		const target = byId(canvasElement, 'coach-target').getBoundingClientRect()
		await expect(tip.bottom).toBeLessThanOrEqual(target.top + 0.5)
		await expect(target.top - tip.bottom).toBeLessThan(32)
		await expect(tip.left).toBeLessThan(target.right)
		await expect(tip.right).toBeGreaterThan(target.left)
	},
} satisfies Story

export const MessageTreatment = {
	render: render(),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/coach-mark "Tooltip renders without solid background"
		await shownSpotlight(canvasElement)
		const tooltip = within(canvasElement).getByRole('tooltip')
		const text = within(canvasElement).getByText(MESSAGE)
		const tip = getComputedStyle(tooltip)
		const msg = getComputedStyle(text)
		// White text straight on the dim: no box, no shadow.
		await expect(msg.color).toMatch(/^(rgb\(255, 255, 255\)|oklch\(1 0 0\))$/)
		for (const s of [tip, msg]) {
			await expect(s.backgroundColor).toBe('rgba(0, 0, 0, 0)')
			await expect(s.backgroundImage).toBe('none')
			await expect(s.boxShadow).toBe('none')
			await expect(s.textShadow).toBe('none')
			await expect(s.filter).toBe('none')
		}
		// The app's base UI font, at most 320px wide.
		await expect(msg.fontFamily).toBe(
			getComputedStyle(document.body).fontFamily,
		)
		await expect(tooltip.getBoundingClientRect().width).toBeLessThanOrEqual(320)
	},
} satisfies Story

export const JapanesePhraseBreak = {
	render: render(),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/coach-mark "Japanese message breaks at phrase boundaries"
		await shownSpotlight(canvasElement)
		const text = within(canvasElement).getByText(MESSAGE)
		// A width of 11.5 characters: breaking by characters alone would end the
		// first line at 「チ」 and split 「チケット」 (index 10–13).
		text.style.inlineSize = '11.5em'
		const node = text.firstChild as Text
		const content = node.data
		const lineOf = (i: number): number => {
			const range = document.createRange()
			range.setStart(node, i)
			range.setEnd(node, i + 1)
			return Math.round(range.getBoundingClientRect().top)
		}
		const first = content.indexOf(MESSAGE[0])
		const last = first + MESSAGE.length - 1
		// The message does wrap onto two lines at this width…
		await expect(lineOf(last)).toBeGreaterThan(lineOf(first))
		// …and 「チケット」 stays on one of them.
		const word = content.indexOf('チケット')
		const lines = new Set(
			Array.from({ length: 'チケット'.length }, (_, k) => lineOf(word + k)),
		)
		await expect(lines.size).toBe(1)
	},
} satisfies Story
