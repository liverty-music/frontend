import { IRouteContext, IRouter, IRouterEvents } from '@aurelia/router'
import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { Registration } from 'aurelia'
import { expect, waitFor } from 'storybook/test'
import { resolveColor } from '../../../.storybook/contrast'
import { hoverPointer } from '../../../.storybook/gestures'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { expectTargets } from '../../../.storybook/target-size'
import { atWidth } from '../../../.storybook/viewport'
import { IFabMenuService } from '../../services/fab-menu-service'
import { BottomNavBar } from './bottom-nav-bar'

/** The four tab routes of the shell, as the router's navigation model gives them. */
const TABS = [
	{ id: 'dashboard', icon: 'home', labelKey: 'nav.home', active: true },
	{ id: 'discovery', icon: 'discovery', labelKey: 'nav.discovery' },
	{ id: 'my-artists', icon: 'my-artists', labelKey: 'nav.myArtists' },
	{ id: 'tickets', icon: 'ticket', labelKey: 'nav.tickets' },
].map((t) => ({
	id: t.id,
	path: [t.id],
	isActive: !!t.active,
	data: { icon: t.icon, labelKey: t.labelKey },
}))

/** Fakes for the router and the launcher: the bar reads nothing else. */
const items = [
	Registration.instance(IRouteContext, {
		routeConfigContext: {
			navigationModel: { resolve: () => undefined, routes: TABS },
		},
	}),
	Registration.instance(IRouter, { routeTree: null, load: async () => true }),
	Registration.instance(IRouterEvents, {
		subscribe: () => ({ dispose: () => undefined }),
	}),
	// One launcher action: the FAB shows and the bar cuts its notch.
	Registration.instance(IFabMenuService, {
		actions: [{ id: 'help', icon: 'info', labelKey: 'fab.help' }],
	}),
]

const meta = {
	title: 'Components/BottomNavBar',
	component: BottomNavBar,
} satisfies Meta<typeof BottomNavBar>

export default meta
type Story = StoryObj<typeof meta>

/** The bar at the bottom of a phone screen; `safeArea` stands in for env(). */
const render =
	(safeArea = 0): Story['render'] =>
	() =>
		defineAureliaStory({
			template: `
				<div style="position: fixed; inset-inline: 0; inset-block-end: 0">
					<bottom-nav-bar style="--_safe-area-bottom: ${safeArea}px"></bottom-nav-bar>
				</div>
			`,
			register: [BottomNavBar],
			items,
		})

const bar = (root: HTMLElement) =>
	root.querySelector('bottom-nav-bar nav') as HTMLElement

async function tabsShown(root: HTMLElement): Promise<HTMLElement[]> {
	await waitFor(() => expect(root.querySelectorAll('.nav-tab')).toHaveLength(4))
	return [...root.querySelectorAll<HTMLElement>('.nav-tab')]
}

/**
 * Each tab: a 24 px icon above its label, in label-medium (12 px, 0.5 px
 * tracking) or, on a bar narrower than 360 px, label-small with no tracking
 * (11 px); the selected tab's label in the emphasized weight.
 */
async function expectTabParts(
	tabs: HTMLElement[],
	type: { size: string; tracking: string },
): Promise<void> {
	for (const tab of tabs) {
		const icon = tab.querySelector('svg-icon') as HTMLElement
		await expect(icon.getBoundingClientRect().width).toBe(24)
		const label = getComputedStyle(tab.querySelector('.nav-label') as Element)
		await expect(label.fontSize).toBe(type.size)
		await expect(label.lineHeight).toBe('16px')
		await expect(label.letterSpacing).toBe(type.tracking)
		await expect(label.fontWeight).toBe(
			tab.dataset.active === 'true' ? '600' : '500',
		)
	}
}

const LABEL_MEDIUM = { size: '12px', tracking: '0.5px' }
// A zero letter-spacing computes to `normal`.
const LABEL_SMALL_UNTRACKED = { size: '11px', tracking: 'normal' }

/** A phone without a bottom safe area. */
export const BarHeight = {
	render: render(),
	play: async ({ canvasElement }) => {
		const tabs = await tabsShown(canvasElement)
		// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Bar height"
		await expect(bar(canvasElement).getBoundingClientRect().height).toBe(64)
		for (const tab of tabs) {
			await expect(tab.getBoundingClientRect().height).toBe(64)
		}
		await expectTabParts(tabs, LABEL_MEDIUM)
		await expectScreenshot(bar(canvasElement), 'bottom-nav-bar')
	},
} satisfies Story

/** A phone with a 34 px home indicator area below the bar. */
export const HomeIndicator = {
	render: render(34),
	play: async ({ canvasElement }) => {
		const tabs = await tabsShown(canvasElement)
		const box = bar(canvasElement).getBoundingClientRect()
		// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Bar on a phone with a home indicator"
		await expect(box.height).toBe(64 + 34)
		for (const tab of tabs) {
			const t = tab.getBoundingClientRect()
			await expect(t.height).toBe(64)
			await expect(t.top).toBeCloseTo(box.top, 0)
			await expect(t.bottom).toBeLessThanOrEqual(box.bottom - 34 + 0.5)
		}
	},
} satisfies Story

/**
 * At 320 px the four tabs share the width with the FAB's slot: the labels
 * switch to label-small, every label shows in full on one line, two
 * neighbouring labels keep a gap, and each tab takes a 48 px tap without
 * reaching a neighbour. The FAB is not in this story; the e2e test
 * "Bar on a 320 px screen" checks the labels and taps against it with the
 * app's real typeface.
 */
export const NarrowWindow = {
	render: render(),
	play: async ({ canvasElement }) => {
		await atWidth(320, async () => {
			const tabs = await tabsShown(canvasElement)
			await expectTabParts(tabs, LABEL_SMALL_UNTRACKED)
			expectTargets(canvasElement, '.nav-tab')
			const labels = tabs.map(
				(tab) => tab.querySelector('.nav-label') as HTMLElement,
			)
			for (const label of labels) {
				await expect(label.getBoundingClientRect().height).toBe(16)
				await expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth)
			}
			for (const [a, b] of [
				[0, 1],
				[2, 3],
			]) {
				const left = labels[a].getBoundingClientRect()
				const right = labels[b].getBoundingClientRect()
				await expect(right.left - left.right).toBeGreaterThanOrEqual(4)
			}
			// The inner tabs' icons stay clear of the notch, 36 px around the
			// bar's centre on its top edge (35 px wide at the icons' top).
			const centre = bar(canvasElement).getBoundingClientRect()
			const middle = centre.left + centre.width / 2
			for (const i of [1, 2]) {
				const icon = (
					tabs[i].querySelector('svg-icon') as HTMLElement
				).getBoundingClientRect()
				const nearEdge = i === 1 ? middle - icon.right : icon.left - middle
				await expect(nearEdge).toBeGreaterThanOrEqual(35)
			}
			await expectScreenshot(bar(canvasElement), 'bottom-nav-bar-320')
		})
	},
} satisfies Story

/** The radius token a selected tab rounds to, as the browser computes it. */
const selectedRadius = (root: HTMLElement) => {
	const probe = document.createElement('span')
	probe.style.borderRadius = 'var(--md-sys-shape-corner-large-increased)'
	root.append(probe)
	const value = getComputedStyle(probe).borderTopLeftRadius
	probe.remove()
	return value
}

/**
 * Selecting a tab: the tab that becomes selected takes the rounder shape and
 * the accent colour through transitions, the radius on the spatial spring,
 * not as a static switch. The selected attribute drives it.
 */
export const SelectionSprings = {
	render: render(),
	play: async ({ canvasElement }) => {
		const tabs = await tabsShown(canvasElement)
		const [home, discovery] = tabs
		const rounded = selectedRadius(canvasElement)
		await expect(rounded).not.toBe('0px')
		await expect(getComputedStyle(home).borderTopLeftRadius).toBe(rounded)
		await expect(getComputedStyle(discovery).borderTopLeftRadius).toBe('0px')

		// The transition is declared on the tab: colour and a spring on the radius.
		const declared = getComputedStyle(discovery)
		await expect(declared.transitionProperty).toContain('border-radius')
		await expect(declared.transitionProperty).toContain('color')
		// The radius is the second of the two: its curve overshoots (a control
		// point above 1), the spatial spring; colour's does not.
		const [colourCurve, radiusCurve] =
			declared.transitionTimingFunction.split(/,\s*(?=cubic-bezier)/)
		const rise = (curve: string) =>
			Math.max(
				...[...curve.matchAll(/,\s*(-?[\d.]+)\s*(?=,)/g)].map((m) =>
					Number(m[1]),
				),
			)
		await expect(rise(radiusCurve)).toBeGreaterThan(1)
		await expect(rise(colourCurve)).toBeLessThanOrEqual(1)

		// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Selecting a nav tab springs into state"
		const before = resolveColor(canvasElement, 'var(--color-brand-accent)')
		home.dataset.active = 'false'
		discovery.dataset.active = 'true'
		const running = discovery
			.getAnimations()
			.filter((a): a is CSSTransition => a instanceof CSSTransition)
		// The radius shorthand runs as its four corner longhands.
		await expect(running.map((a) => a.transitionProperty)).toContain(
			'border-top-left-radius',
		)
		await Promise.all(running.map((a) => a.finished))
		await expect(getComputedStyle(discovery).borderTopLeftRadius).toBe(rounded)
		await expect(getComputedStyle(discovery).color).toBe(before)
		await expect(getComputedStyle(home).borderTopLeftRadius).toBe('0px')
	},
} satisfies Story

/**
 * Hover alone selects nothing: a pointer over an unselected tab leaves its
 * shape and colour as they were, while the tab that is selected keeps its
 * treatment with no pointer over it. Only the state attribute changes either.
 */
export const SelectionIgnoresHover = {
	render: render(),
	play: async ({ canvasElement }) => {
		const [home, discovery] = await tabsShown(canvasElement)
		const unselected = getComputedStyle(discovery)
		const shape = unselected.borderTopLeftRadius
		const color = unselected.color

		// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Selection is driven by state, not hover"
		const hovered = await hoverPointer(discovery)
		if (hovered) await expect(discovery.matches(':hover')).toBe(true)
		await new Promise((r) => setTimeout(r, 500))
		await expect(discovery.dataset.active).toBe('false')
		await expect(getComputedStyle(discovery).borderTopLeftRadius).toBe(shape)
		await expect(getComputedStyle(discovery).color).toBe(color)
		await expect(shape).toBe('0px')

		// The selected tab's treatment does not depend on the pointer.
		await expect(home.dataset.active).toBe('true')
		await expect(home.matches(':hover')).toBe(false)
		await expect(getComputedStyle(home).borderTopLeftRadius).toBe(
			selectedRadius(canvasElement),
		)
		await expect(getComputedStyle(home).color).toBe(
			resolveColor(canvasElement, 'var(--color-brand-accent)'),
		)
	},
} satisfies Story
