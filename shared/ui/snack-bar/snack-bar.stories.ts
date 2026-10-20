import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { bindable, customElement, IEventAggregator, resolve } from 'aurelia'
import { expect, userEvent, waitFor, within } from 'storybook/test'
// `expect.element(...).toMatchScreenshot()` is a @vitest/browser matcher, only
// present on Vitest's own `expect` (not the one re-exported by `storybook/test`).
import { expect as vitestExpect } from 'vitest'
import {
	composite,
	contrast,
	resolveColor,
	WCAG_AA,
} from '../../../.storybook/contrast'
import { Snack, type SnackSeverity } from './snack'
import { SnackBar } from './snack-bar'

// SnackBar is driven by `Snack` events on the IEventAggregator, not by
// bindables, so a tiny host publishes one on demand to exercise it in isolation.
@customElement({
	name: 'snack-demo',
	template: `
		<button type="button" click.trigger="fire()">Show snack</button>
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

	public fire(): void {
		// duration: Infinity → stays open (no auto-dismiss race in the test).
		this.ea.publish(
			new Snack(this.message, this.severity, {
				duration: Number.POSITIVE_INFINITY,
				...(this.actionLabel && {
					action: { label: this.actionLabel, callback: () => {} },
				}),
				...(this.update && {
					icon: null,
					attention: true,
					action: { label: '更新', callback: () => {} },
				}),
			}),
		)
	}
}

const meta = {
	title: 'Shared/SnackBar',
	component: SnackBar,
	tags: ['test', 'autodocs'],
} satisfies Meta<typeof SnackBar>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Colours along the snack's container gradient, both ends included. A CSS
 * gradient interpolates in oklab by default, so `color-mix(in oklab, …)` gives
 * the colour painted at each point. axe reports text over a gradient as
 * incomplete, so contrast is measured here instead.
 */
function gradientSamples(snack: HTMLElement): string[] {
	const style = getComputedStyle(snack)
	const from = style.getPropertyValue('--_bg-from').trim()
	const to = style.getPropertyValue('--_bg-to').trim()
	// Every 5%: between two hues the oklab blend loses chroma and can dip
	// below both ends, so the ends alone do not bound the ratio.
	return Array.from({ length: 21 }, (_, i) =>
		resolveColor(snack, `color-mix(in oklab, ${from}, ${to} ${i * 5}%)`),
	)
}

/** Asserts the snack's message reaches 4.5:1 along the whole gradient. */
async function expectMessageContrast(snack: HTMLElement): Promise<void> {
	const message = snack.querySelector<HTMLElement>('.snack-message')
	if (!message) throw new Error('no message')
	const text = getComputedStyle(message).color
	for (const stop of gradientSamples(snack)) {
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
	const snack = action.closest<HTMLElement>('.snack-item')
	if (!snack) throw new Error('no snack')
	const { color, backgroundColor } = getComputedStyle(action)
	for (const stop of gradientSamples(snack)) {
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
			const snack = canvasElement.querySelector<HTMLElement>('.snack-item')
			if (!snack) throw new Error('no snack')
			// @spec components/infrastructure/fan/web/global/snack-bar "Snack severity visual variants"
			await expect(snack.getAttribute('data-severity')).toBe(props.severity)
			await expect(getComputedStyle(snack).backgroundImage).toContain(
				'linear-gradient',
			)
			// @spec components/infrastructure/fan/web/global/snack-bar "Message contrast on every severity"
			await expectMessageContrast(snack)
			// @spec components/infrastructure/fan/web/global/snack-bar "Action contrast on every severity"
			await expectActionContrast(
				canvas.getByRole('button', { name: props.actionLabel }),
			)
			// @spec components/infrastructure/fan/web/global/snack-bar "Accessibility"
			await expect(snack.getAttribute('role')).toBe('status')
			await expect(snack.matches(':popover-open')).toBe(true)
			await expect(snack.matches(':modal')).toBe(false)
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
		const updateSnack = action.closest<HTMLElement>('.snack-item')
		if (!updateSnack) throw new Error('no snack')
		await expectMessageContrast(updateSnack)
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
		const snack = canvasElement.querySelector<HTMLElement>(
			'.snack-item:popover-open',
		)
		if (!snack) throw new Error('snack is not open')
		await Promise.all(
			snack.getAnimations({ subtree: true }).map((a) => a.finished),
		)
		await vitestExpect
			.element(snack)
			.toMatchScreenshot('snack-bar-update-action')
	},
} satisfies Story
