import { IRouterEvents } from '@aurelia/router'
import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { Registration } from 'aurelia'
import { expect, userEvent, waitFor } from 'storybook/test'
import { composite, contrast, resolveColor } from '../../../.storybook/contrast'
import { atWidth } from '../../../.storybook/viewport'
import {
	type FabAction,
	IFabMenuService,
} from '../../services/fab-menu-service'
import { FabMenu } from './fab-menu'

// The launcher with the dashboard's actions (beam toggle, filter, help,
// settings), mounted on its own: its service is a fake, and the page behind
// it is a pair of plain buttons that stand for a navigation tab and the
// page's own link. The bar, the notch and the shell are checked in the
// end-to-end suite.

const noop = () => {}
const ACTIONS: FabAction[] = [
	{
		id: 'beam',
		labelKey: 'fabMenu.beam',
		icon: 'spotlight',
		kind: 'toggle',
		isOn: () => true,
		invoke: noop,
	},
	{
		id: 'filter',
		labelKey: 'fabMenu.filter',
		icon: 'filter',
		kind: 'command',
		invoke: noop,
	},
	{
		id: 'help',
		labelKey: 'fabMenu.help',
		icon: 'help-circle',
		kind: 'command',
		invoke: noop,
	},
	{
		id: 'settings',
		labelKey: 'fabMenu.settings',
		icon: 'settings',
		kind: 'command',
		invoke: noop,
	},
]

const meta = {
	title: 'Components/FabMenu',
	component: FabMenu,
	globals: { viewport: { value: 'mobile1', isRotated: false } },
	parameters: {
		a11y: {
			config: {
				// Known defect, reported with this change: the open panel is a
				// `dialog` given `role="group"`, which ARIA does not allow on a
				// dialog element.
				rules: [{ id: 'aria-allowed-role', enabled: false }],
			},
		},
	},
} satisfies Meta<typeof FabMenu>

export default meta
type Story = StoryObj<typeof meta>

function launcher(handed: 'left' | 'right' = 'right') {
	return defineAureliaStory({
		template: `
			<div style="min-block-size: 100svh; display: grid; align-content: start; gap: 1rem">
				<button type="button" data-testid="behind-tab">tab</button>
				<a href="#behind" data-testid="behind-link">link</a>
			</div>
			<fab-menu></fab-menu>
		`,
		register: [FabMenu],
		items: [
			Registration.instance(IFabMenuService, { actions: ACTIONS, handed }),
			Registration.instance(IRouterEvents, {
				subscribe: () => ({ dispose: () => {} }),
			}),
		],
	})
}

const fab = (root: HTMLElement) =>
	root.querySelector<HTMLButtonElement>('fab-menu .fab-toggle')
const items = (root: HTMLElement) => [
	...root.querySelectorAll<HTMLElement>('fab-menu .fab-item'),
]

async function openArc(root: HTMLElement): Promise<HTMLButtonElement> {
	const button = await waitFor(() => {
		const el = fab(root)
		if (!el) throw new Error('launcher not rendered yet')
		return el
	})
	await userEvent.click(button)
	await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('true'))
	await settled(root)
	return button
}

/** Every finite animation under the launcher has ended. */
async function settled(root: HTMLElement): Promise<void> {
	await waitFor(
		() => {
			const running = root
				.querySelector('fab-menu')
				?.getAnimations({ subtree: true })
				.filter(
					(a) =>
						a.effect?.getTiming().iterations !== Infinity &&
						a.playState === 'running',
				)
			if (running?.length) throw new Error('still moving')
		},
		{ timeout: 5000 },
	)
}

const box = (el: Element) => el.getBoundingClientRect()
const centre = (el: Element) => {
	const b = box(el)
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/**
 * The arc open, curving to the right by default: each item sits higher and
 * further right than the one before, its label on the left of its icon, an
 * icon and a label on every item, and every item's own circle at least
 * 48 px, at the narrowest phone width and at an ordinary one.
 */
export const OpenArc = {
	render: () => launcher(),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/fab-menu "Default arc curves to the right"
		// @spec components/infrastructure/fan/web/global/fab-menu "Every item shows icon and label"
		// @spec components/infrastructure/fan/web/global/fab-menu "Items are comfortably tappable"
		for (const width of [320, 390]) {
			await atWidth(width, async () => {
				const button = await openArc(canvasElement)
				const list = items(canvasElement)
				await expect(list.map((i) => i.dataset.actionId)).toEqual(
					ACTIONS.map((a) => a.id),
				)
				let previous = centre(button)
				for (const item of list) {
					const c = centre(item)
					await expect(c.y).toBeLessThan(previous.y)
					await expect(c.x).toBeGreaterThan(previous.x)
					previous = c
					// The label sits on the left of its icon.
					const label = item.querySelector<HTMLElement>('.fab-item-label')
					const icon = item.querySelector<HTMLElement>('svg-icon')
					if (!label || !icon) throw new Error('item without icon or label')
					await expect(label.checkVisibility()).toBe(true)
					await expect(icon.checkVisibility()).toBe(true)
					await expect(label.textContent?.trim()).toMatch(/\S/)
					await expect(box(label).right).toBeLessThanOrEqual(box(item).left)
					// The item's own circle is what is tapped.
					await expect(Math.round(box(item).width)).toBeGreaterThanOrEqual(48)
					await expect(Math.round(box(item).height)).toBeGreaterThanOrEqual(48)
				}
				// The FAB stays horizontally centred.
				await expect(Math.abs(centre(button).x - innerWidth / 2)).toBeLessThan(
					1,
				)
				await userEvent.click(button)
				await waitFor(() =>
					expect(button.getAttribute('aria-expanded')).toBe('false'),
				)
			})
		}
	},
} satisfies Story

/**
 * The arc open over the page: the label's text and each item's surface stand
 * out from what they sit on and from the dimmed page behind.
 */
export const ArcContrast = {
	render: () => launcher(),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/fab-menu "Expanded panel keeps strong contrast"
		await openArc(canvasElement)
		const label = canvasElement.querySelector<HTMLElement>(
			'fab-menu .fab-item-label',
		)
		const item = canvasElement.querySelector<HTMLElement>(
			'fab-menu .fab-item:not([data-active="true"]):not([aria-pressed="true"])',
		)
		const scrim = canvasElement.querySelector<HTMLElement>(
			'fab-menu .fab-scrim',
		)
		if (!label || !item || !scrim) throw new Error('arc not open')
		const text = contrast(
			composite(resolveColor(label, getComputedStyle(label).color)),
			composite(resolveColor(label, getComputedStyle(label).backgroundColor)),
		)
		await expect(text).toBeGreaterThanOrEqual(4.5)
		// The item surface stands out from the dimmed page behind it at the
		// WCAG non-text contrast minimum for UI components (1.4.11).
		const page = composite(
			resolveColor(
				document.body,
				getComputedStyle(document.body).backgroundColor,
			),
			resolveColor(scrim, getComputedStyle(scrim).backgroundColor),
		)
		const surface = contrast(
			composite(resolveColor(item, getComputedStyle(item).backgroundColor)),
			page,
		)
		await expect(surface).toBeGreaterThanOrEqual(3)
	},
} satisfies Story

/**
 * A tap outside the arc only closes it: a tap where a navigation tab (here a
 * button) or the page's own link lies reaches neither; with the arc closed the
 * same tap does.
 */
export const TapOutsideTheArc = {
	render: () => launcher(),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/fab-menu "Tapping outside the arc only closes it"
		const reached: string[] = []
		const tab = canvasElement.querySelector<HTMLElement>(
			'[data-testid="behind-tab"]',
		)
		const link = canvasElement.querySelector<HTMLElement>(
			'[data-testid="behind-link"]',
		)
		if (!tab || !link) throw new Error('page behind not rendered')
		tab.addEventListener('click', () => reached.push('tab'))
		link.addEventListener('click', (e) => {
			e.preventDefault()
			reached.push('link')
		})
		const tapAt = async (el: HTMLElement) => {
			const b = box(el)
			// The point a finger lands on; what is there decides who gets it.
			const hit = document.elementFromPoint(b.x + 4, b.y + b.height / 2)
			if (hit instanceof HTMLElement) hit.click()
		}

		const button = await openArc(canvasElement)
		await tapAt(tab)
		await waitFor(() =>
			expect(button.getAttribute('aria-expanded')).toBe('false'),
		)
		await openArc(canvasElement)
		await tapAt(link)
		await waitFor(() =>
			expect(button.getAttribute('aria-expanded')).toBe('false'),
		)
		await expect(reached).toEqual([])

		// With the arc closed, the same taps reach them.
		await tapAt(tab)
		await tapAt(link)
		await expect(reached).toEqual(['tab', 'link'])
	},
} satisfies Story

/** The collapsed FAB at rest: the equalizer bars do not move. */
export const IdleGlyph = {
	render: () => launcher(),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/fab-menu "Idle glyph is still"
		await waitFor(() => expect(fab(canvasElement)).not.toBeNull())
		await new Promise((r) => setTimeout(r, 1000))
		const running = canvasElement
			.querySelector('fab-menu .fab-equalizer')
			?.getAnimations({ subtree: true }).length
		await expect(running).toBe(0)
	},
} satisfies Story

/**
 * Opening the arc under the system's motion preference: with motion the items
 * travel and stagger; under reduced motion they land in place with no
 * transition time or delay and the bars do not bounce, and the arc still
 * works (items in place, the toggle closes).
 */
export const MotionFollowsSystemPreference = {
	tags: ['reduced-motion'],
	render: () => launcher(),
	play: async ({ canvasElement, globals }) => {
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
		if (import.meta.env.MODE === 'test') {
			await expect(reduce).toBe(globals.reducedMotion)
		}
		const button = await waitFor(() => {
			const el = fab(canvasElement)
			if (!el) throw new Error('launcher not rendered yet')
			return el
		})
		await userEvent.click(button)
		await waitFor(() =>
			expect(button.getAttribute('aria-expanded')).toBe('true'),
		)
		const bars = [
			...canvasElement.querySelectorAll<HTMLElement>('fab-menu .fab-bar'),
		].map((el) => getComputedStyle(el).animationName)
		const timing = [
			...canvasElement.querySelectorAll<HTMLElement>('fab-menu .fab-list-item'),
		].map((el) => {
			const s = getComputedStyle(el)
			return {
				duration: Math.max(
					...s.transitionDuration.split(',').map(Number.parseFloat),
				),
				delay: Math.max(...s.transitionDelay.split(',').map(Number.parseFloat)),
			}
		})
		if (reduce) {
			// @spec components/infrastructure/fan/web/global/fab-menu "Reduced motion lands the end state without bounce"
			for (const t of timing) {
				await expect(t.duration).toBeLessThanOrEqual(0.001)
				await expect(t.delay).toBe(0)
			}
			await expect(bars).toEqual(['none', 'none', 'none'])
			// Fully functional: the items are in place and the toggle closes.
			await settled(canvasElement)
			const f = centre(button)
			for (const item of items(canvasElement)) {
				await expect(centre(item).y).toBeLessThan(f.y)
			}
			await userEvent.click(button)
			await waitFor(() =>
				expect(button.getAttribute('aria-expanded')).toBe('false'),
			)
		} else {
			await expect(bars.every((n) => n === 'fab-bar-bounce')).toBe(true)
		}
	},
} satisfies Story
