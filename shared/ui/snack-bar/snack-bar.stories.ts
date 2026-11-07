import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { bindable, customElement, IEventAggregator, resolve } from 'aurelia'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import {
	composite,
	contrast,
	resolveColor,
	WCAG_AA,
} from '../../../.storybook/contrast'
import {
	pressAndHold,
	releasePointer,
	swipeSideways,
} from '../../../.storybook/gestures'
import { expectScreenshot } from '../../../.storybook/screenshot'
import { Snack, type SnackSeverity } from './snack'
import { SnackBar } from './snack-bar'

/** What the snacks' callbacks did, for the stories to assert. */
const record = { dismissals: 0, actions: 0 }

// SnackBar is driven by `Snack` events on the IEventAggregator, not by
// bindables, so a tiny host publishes them on demand to exercise it in isolation.
@customElement({
	name: 'snack-demo',
	template: `
		<button type="button" click.trigger="fire()">Show snack</button>
		<button type="button" click.trigger="fireFour()">Show four snacks</button>
		<button type="button" click.trigger="fireTimed()">Show a 4-second snack</button>
		<button type="button" click.trigger="dismissLast()">Dismiss</button>
		<snack-bar></snack-bar>
	`,
})
class SnackDemo {
	@bindable public severity: SnackSeverity = 'info'
	@bindable public message = 'チケットを保存しました'
	/** Publish the fan app's update snack (main.ts) instead of a plain one. */
	@bindable public update = false
	/** Give a plain snack an action with this label. */
	@bindable public actionLabel = ''
	private readonly ea = resolve(IEventAggregator)
	private last: Snack | null = null

	/** Publish a snack that stays until it is dismissed (no timer race). */
	public fire(): void {
		this.publish(
			new Snack(this.message, this.severity, {
				duration: Number.POSITIVE_INFINITY,
				onDismiss: () => record.dismissals++,
				...(this.actionLabel && {
					action: { label: this.actionLabel, callback: () => {} },
				}),
				...(this.update && {
					icon: null,
					attention: true,
					action: { label: '更新', callback: () => record.actions++ },
				}),
			}),
		)
	}

	/** Publish four short snacks at once, numbered in publishing order. */
	public fireFour(): void {
		for (let i = 1; i <= 4; i++) {
			this.publish(new Snack(`スナック${i}`, 'info', { duration: 400 }))
		}
	}

	/** Publish a snack with the short (4 s) Material 3 duration. */
	public fireTimed(): void {
		this.publish(new Snack('パスキーを追加しました。', 'info'))
	}

	public dismissLast(): void {
		this.last?.handle?.dismiss()
	}

	private publish(snack: Snack): void {
		this.last = snack
		this.ea.publish(snack)
	}
}

const meta = {
	title: 'Shared/SnackBar',
	component: SnackBar,
} satisfies Meta<typeof SnackBar>

export default meta
type Story = StoryObj<typeof meta>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The open snack's popover and the surface the fan sees inside it. */
async function openSnack(canvasElement: HTMLElement) {
	return waitFor(() => {
		const item = canvasElement.querySelector<HTMLElement>(
			'.snack-item:popover-open',
		)
		const surface = item?.querySelector<HTMLElement>('.snack-surface')
		if (!item || !surface) throw new Error('no open snack')
		return { item, surface }
	})
}

/** Waits until the snack's entry motion has ended. */
async function settled(item: HTMLElement): Promise<void> {
	await Promise.all(item.getAnimations().map((a) => a.finished))
}

/**
 * Colours along the snack's container gradient, both ends included. A CSS
 * gradient interpolates in oklab by default, so `color-mix(in oklab, …)` gives
 * the colour painted at each point. axe reports text over a gradient as
 * incomplete, so contrast is measured here instead.
 */
function gradientSamples(surface: HTMLElement): string[] {
	const style = getComputedStyle(surface)
	const from = style.getPropertyValue('--_bg-from').trim()
	const to = style.getPropertyValue('--_bg-to').trim()
	// Every 5%: between two hues the oklab blend loses chroma and can dip
	// below both ends, so the ends alone do not bound the ratio.
	return Array.from({ length: 21 }, (_, i) =>
		resolveColor(surface, `color-mix(in oklab, ${from}, ${to} ${i * 5}%)`),
	)
}

/** Asserts the snack's message reaches 4.5:1 along the whole gradient. */
async function expectMessageContrast(surface: HTMLElement): Promise<void> {
	const message = surface.querySelector<HTMLElement>('.snack-message')
	if (!message) throw new Error('no message')
	const text = getComputedStyle(message).color
	for (const stop of gradientSamples(surface)) {
		await expect(
			contrast(composite(stop, text), composite(stop)),
		).toBeGreaterThanOrEqual(WCAG_AA)
	}
}

/**
 * Asserts the action's label reaches 4.5:1 against its translucent fill laid
 * over every point of the gradient.
 */
async function expectActionContrast(action: HTMLElement): Promise<void> {
	const surface = action.closest<HTMLElement>('.snack-surface')
	if (!surface) throw new Error('no snack')
	const { color, backgroundColor } = getComputedStyle(action)
	for (const stop of gradientSamples(surface)) {
		const fill = composite(stop, backgroundColor)
		const label = composite(stop, backgroundColor, color)
		await expect(contrast(label, fill)).toBeGreaterThanOrEqual(WCAG_AA)
	}
}

function snackStory(props: {
	severity: SnackSeverity
	message: string
	actionLabel: string
}) {
	return {
		render: () =>
			defineAureliaStory({
				template: `<snack-demo severity.bind="severity" message.bind="message" action-label.bind="actionLabel"></snack-demo>`,
				props,
				register: [SnackDemo, SnackBar],
			}),
		play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
			const canvas = within(canvasElement)
			await userEvent.click(canvas.getByRole('button', { name: 'Show snack' }))
			await waitFor(() =>
				expect(canvas.getByText(props.message)).toBeInTheDocument(),
			)
			const { item, surface } = await openSnack(canvasElement)
			// @spec components/infrastructure/fan/web/global/snack-bar "Snack severity visual variants"
			await expect(item.getAttribute('data-severity')).toBe(props.severity)
			await expect(getComputedStyle(surface).backgroundImage).toContain(
				'linear-gradient',
			)
			// @spec components/infrastructure/fan/web/global/snack-bar "Message contrast on every severity"
			await expectMessageContrast(surface)
			// @spec components/infrastructure/fan/web/global/snack-bar "Action contrast on every severity"
			await expectActionContrast(
				canvas.getByRole('button', { name: props.actionLabel }),
			)
			// @spec components/infrastructure/fan/web/global/snack-bar "Accessibility"
			await expect(item.getAttribute('role')).toBe('status')
			await expect(item.getAttribute('popover')).toBe('manual')
			await expect(item.matches(':modal')).toBe(false)
		},
	} satisfies Story
}

export const Info = snackStory({
	severity: 'info',
	message: 'チケットを保存しました',
	actionLabel: '元に戻す',
})

export const Warning = snackStory({
	severity: 'warning',
	message: 'ネットワークが不安定です',
	actionLabel: '再試行',
})

export const ErrorSeverity = snackStory({
	severity: 'error',
	message: '保存に失敗しました',
	actionLabel: '再試行',
})

/**
 * The update snack main.ts publishes when a new version is waiting: a refresh
 * icon and an on-container action that glows three times. Tagged
 * `reduced-motion`, so it also runs with motion reduced and asserts the glow
 * that matches the preference.
 */
export const UpdateAction = {
	tags: ['reduced-motion'],
	render: () =>
		defineAureliaStory({
			template: `<snack-demo message.bind="message" update.bind="true"></snack-demo>`,
			props: { message: '新しいバージョンがあります' },
			register: [SnackDemo, SnackBar],
		}),
	play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: 'Show snack' }))
		const action = await waitFor(() =>
			canvas.getByRole('button', { name: '更新' }),
		)
		const style = getComputedStyle(action)

		// @spec components/infrastructure/fan/web/global/snack-bar "Action button appears in the on-container style"
		await expect(
			Number.parseFloat(style.borderTopWidth),
		).toBeGreaterThanOrEqual(1.5)
		await expect(style.borderTopColor).not.toBe('rgba(0, 0, 0, 0)')
		await expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
		await expect(style.borderTopLeftRadius).toBe('12px')

		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		if (reduced) {
			// @spec components/infrastructure/fan/web/global/snack-bar "Reduced motion preference"
			const snackItem = canvasElement.querySelector('.snack-item')
			if (!snackItem) throw new Error('no snack')
			await expect(
				getComputedStyle(snackItem)
					.transitionDuration.split(',')
					.every((d) => Number.parseFloat(d) === 0),
			).toBe(true)
			// @spec components/infrastructure/fan/web/global/snack-bar "Animation is suppressed under reduced motion"
			await expect(style.animationName).toBe('none')
			await expect(action.getAnimations()).toHaveLength(0)
		} else {
			// @spec components/infrastructure/fan/web/global/snack-bar "The glow plays three times, then stops"
			await expect(style.animationName).toBe('snack-action-glow')
			await expect(style.animationIterationCount).toBe('3')
			const glow = action.getAnimations()[0]
			await glow.finished
			await expect(glow.playState).toBe('finished')
		}

		// @spec components/infrastructure/fan/web/global/snack-bar "Message contrast on every severity"
		// @spec components/infrastructure/fan/web/global/snack-bar "Action contrast on every severity"
		const surface = action.closest<HTMLElement>('.snack-surface')
		if (!surface) throw new Error('no snack')
		await expectMessageContrast(surface)
		await expectActionContrast(action)

		// @spec components/infrastructure/fan/web/global/snack-bar "No leading icon"
		await expect(canvasElement.querySelector('.snack-icon')).toBeNull()

		// @spec components/infrastructure/fan/web/global/ui-primitives "Compact button on a snack bar"
		// Smaller than the default button, with the same radius and weight, so
		// the message keeps the row (the e2e checks one line at 360px).
		await expect(Number.parseFloat(style.minHeight)).toBe(36)
		await expect(Number.parseFloat(style.fontSize)).toBeLessThan(19)
		await expect(style.fontWeight).toBe('700')

		// After the glow (or with none), both projects render the same still
		// frame.
		const { item } = await openSnack(canvasElement)
		await Promise.all(
			item.getAnimations({ subtree: true }).map((a) => a.finished),
		)
		await expectScreenshot(item, 'snack-bar-update-action')
	},
} satisfies Story

const demo =
	(props: Record<string, unknown> = {}) =>
	() =>
		defineAureliaStory({
			template: `<snack-demo message.bind="message" update.bind="update"></snack-demo>`,
			props: { message: 'チケットを保存しました', update: false, ...props },
			register: [SnackDemo, SnackBar],
		})

/**
 * Four snacks published at once appear one at a time, in the order they were
 * published, each after the one before it has gone.
 */
export const Queue = {
	render: demo(),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const seen: string[] = []
		let most = 0
		let sampling = true
		const sample = () => {
			const items = canvasElement.querySelectorAll('.snack-item')
			most = Math.max(most, items.length)
			const message = items[0]?.querySelector('.snack-message')?.textContent
			if (message && seen.at(-1) !== message.trim()) seen.push(message.trim())
			if (sampling) requestAnimationFrame(sample)
		}
		sample()
		await userEvent.click(
			canvas.getByRole('button', { name: 'Show four snacks' }),
		)
		await waitFor(
			() =>
				expect(seen).toEqual([
					'スナック1',
					'スナック2',
					'スナック3',
					'スナック4',
				]),
			{ timeout: 8000 },
		)
		await waitFor(
			() => expect(canvasElement.querySelector('.snack-item')).toBeNull(),
			{ timeout: 3000 },
		)
		sampling = false

		// @spec components/infrastructure/fan/web/global/snack-bar "Waiting snacks keep their order"
		// @spec components/infrastructure/fan/web/global/snack-bar "A second snack waits"
		// At no frame were two snacks in the document, shown or leaving.
		await expect(most).toBe(1)
	},
} satisfies Story

/**
 * A dismissed snack sinks and fades out before it leaves the document; with
 * motion reduced it goes at once.
 */
export const ExitMotion = {
	tags: ['reduced-motion'],
	render: demo(),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: 'Show snack' }))
		const { item } = await openSnack(canvasElement)
		await settled(item)
		await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }))

		if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
			// @spec components/infrastructure/fan/web/global/snack-bar "Reduced motion preference"
			await waitFor(() => expect(item.isConnected).toBe(false), {
				timeout: 100,
			})
			return
		}
		// @spec components/infrastructure/fan/web/global/snack-bar "DOM cleanup after exit transition"
		await sleep(100)
		await expect(item.isConnected).toBe(true)
		await expect(Number(getComputedStyle(item).opacity)).toBeLessThan(1)
		await waitFor(() => expect(item.isConnected).toBe(false), {
			timeout: 1000,
		})
	},
} satisfies Story

/**
 * A swipe past half the snack's width carries it away and dismisses it once;
 * with motion reduced it goes without an exit motion.
 */
export const SwipePastHalf = {
	tags: ['reduced-motion'],
	render: demo(),
	play: async ({ canvasElement }) => {
		record.dismissals = 0
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: 'Show snack' }))
		const { item, surface } = await openSnack(canvasElement)
		await settled(item)
		const before = surface.getBoundingClientRect()

		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		if (!(await swipeSideways('.snack-surface', -0.7 * before.width))) return

		if (!reduced) {
			// @spec components/infrastructure/fan/web/global/snack-bar "Swipe past the dismiss point"
			// It leaves to the left, the way it was swiped.
			await waitFor(() =>
				expect(surface.getBoundingClientRect().left).toBeLessThan(
					before.left - before.width / 2,
				),
			)
		} else {
			// @spec components/infrastructure/fan/web/global/snack-bar "Swipe under reduced motion"
			await expect(item.getAnimations()).toHaveLength(0)
		}
		await waitFor(() => expect(item.isConnected).toBe(false), {
			timeout: 1000,
		})
		await expect(record.dismissals).toBe(1)
	},
} satisfies Story

/** A swipe shorter than half the width lets the snack return to its place. */
export const ShortSwipe = {
	render: demo(),
	play: async ({ canvasElement }) => {
		record.dismissals = 0
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: 'Show snack' }))
		const { item, surface } = await openSnack(canvasElement)
		await settled(item)
		const before = surface.getBoundingClientRect()

		if (!(await swipeSideways('.snack-surface', -0.3 * before.width))) return

		// @spec components/infrastructure/fan/web/global/snack-bar "Short swipe"
		await waitFor(() =>
			expect(
				Math.abs(surface.getBoundingClientRect().left - before.left),
			).toBeLessThan(1),
		)
		await sleep(300)
		await expect(item.matches(':popover-open')).toBe(true)
		await expect(record.dismissals).toBe(0)
	},
} satisfies Story

/**
 * A 4-second snack held for 5 seconds stays, and after release goes when the
 * time it had left runs out, not at once.
 *
 * The times are measured, not assumed: under a loaded test run the press and
 * the checks can land later than asked, and a timer fires late but never
 * early. The press comes 1 second in, leaving about 3 seconds; the snack must
 * then stay at least 1 second after release and go within what it had left
 * plus a margin. This checks that a real pointer press reaches the timer; the
 * timer's arithmetic is verified in snack-item.spec.ts.
 */
export const HoldPausesTimer = {
	render: demo(),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(
			canvas.getByRole('button', { name: 'Show a 4-second snack' }),
		)
		const { item } = await openSnack(canvasElement)
		await sleep(1000)
		if (!(await pressAndHold('.snack-surface'))) return
		// The press landed before the snack timed out.
		await expect(item.matches(':popover-open')).toBe(true)
		await sleep(5000)

		// A real held pointer pauses the timer. The scenario "Holding pauses the
		// timer", with its exact times, is verified in snack-item.spec.ts.
		await expect(item.matches(':popover-open')).toBe(true)
		const released = performance.now()
		await releasePointer()

		await waitFor(() => expect(item.matches(':popover-open')).toBe(false), {
			timeout: 5000,
		})
		await expect(performance.now() - released).toBeGreaterThanOrEqual(1000)
	},
} satisfies Story

/** The update snack, swiped away, is dismissed and the update not applied. */
export const SwipeUpdateSnack = {
	render: demo({ message: '新しいバージョンがあります', update: true }),
	play: async ({ canvasElement }) => {
		record.dismissals = 0
		record.actions = 0
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: 'Show snack' }))
		const { item, surface } = await openSnack(canvasElement)
		await settled(item)
		const width = surface.getBoundingClientRect().width

		if (!(await swipeSideways('.snack-surface', 0.7 * width))) return

		// @spec components/infrastructure/fan/web/global/snack-bar "Swipe on a snack that stays until the fan acts"
		await waitFor(() => expect(item.isConnected).toBe(false), {
			timeout: 1500,
		})
		await expect(record.dismissals).toBe(1)
		await expect(record.actions).toBe(0)
	},
} satisfies Story
