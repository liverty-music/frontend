import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { bindable, customElement, IEventAggregator, resolve } from 'aurelia'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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
	private readonly ea = resolve(IEventAggregator)

	public fire(): void {
		// duration: Infinity → stays open (no auto-dismiss race in the test).
		this.ea.publish(
			new Snack(this.message, this.severity, {
				duration: Number.POSITIVE_INFINITY,
			}),
		)
	}
}

const meta = {
	title: 'Components/SnackBar',
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
