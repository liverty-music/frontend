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
	private readonly ea = resolve(IEventAggregator)

	public fire(): void {
		// duration: Infinity → stays open (no auto-dismiss race in the test).
		this.ea.publish(
			new Snack(this.message, this.severity, {
				duration: Number.POSITIVE_INFINITY,
				...(this.update && {
					icon: 'rotate-ccw',
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

function snackStory(props: { severity: SnackSeverity; message: string }) {
	return {
		render: () =>
			defineAureliaStory({
				template: `<snack-demo severity.bind="severity" message.bind="message"></snack-demo>`,
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
})

export const Warning = snackStory({
	severity: 'warning',
	message: 'ネットワークが不安定です',
})

export const ErrorSeverity = snackStory({
	severity: 'error',
	message: '保存に失敗しました',
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

		// @spec components/infrastructure/fan/web/global/snack-bar "Leading icon depicts a refresh"
		const icon = canvasElement.querySelector('.snack-icon')
		await expect(icon?.getAttribute('data-icon')).toBe('rotate-ccw')

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
			.toMatchScreenshot('snack-bar-update-action', {
				comparatorName: 'pixelmatch',
				comparatorOptions: { allowedMismatchedPixelRatio: 0.001 },
			})
	},
} satisfies Story
