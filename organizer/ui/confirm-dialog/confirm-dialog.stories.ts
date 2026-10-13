import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor, within } from 'storybook/test'
import { userEvent } from 'vitest/browser'
import { consoleStoryParameters } from '../story-support'
import { ConfirmDialog } from './confirm-dialog'

const meta = {
	title: 'Console/ConfirmDialog',
	component: ConfirmDialog,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		heading: { control: 'text' },
		confirmLabel: { control: 'text' },
		confirmVariant: {
			control: 'select',
			options: ['filled', 'danger'],
		},
	},
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

interface DialogHost {
	dialog: ConfirmDialog
	result: string
}

const host = (opener: string, dialog: string) => ({
	template: `
		<div style="padding:24px; background:var(--md-color-surface); color:var(--md-color-on-surface)">
			${opener}
			${dialog}
			<output data-testid="result">\${result}</output>
		</div>
	`,
	props: {
		result: 'none',
		async open(this: DialogHost, done: string) {
			this.result = (await this.dialog.ask()) ? done : 'kept'
		},
	},
})

const publish = host(
	`<console-button variant="filled" click.trigger="open('published')">公開する</console-button>`,
	`<confirm-dialog component.ref="dialog" heading="XX Tour 2026 11月3日の公演を公開しますか？" confirm-label="公開する">
		出演者のフォロワーに通知されます。公開すると下書きには戻せません。
	</confirm-dialog>`,
)

export const PublishAsksFirst = {
	render: () => defineAureliaStory(publish),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Publish asks first"
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: '公開する' }))

		const dialog = await canvas.findByRole('dialog', {
			name: 'XX Tour 2026 11月3日の公演を公開しますか？',
		})
		await expect(dialog).toHaveTextContent('フォロワーに通知されます')
		await expect(dialog).toHaveTextContent('下書きには戻せません')
		await expect(canvas.getByTestId('result')).toHaveTextContent('none')
		// The dialog takes focus, on its safe choice.
		await expect(dialog.contains(document.activeElement)).toBe(true)

		await userEvent.click(
			within(dialog).getByRole('button', { name: '公開する' }),
		)

		await expect(canvas.getByTestId('result')).toHaveTextContent('published')
		await expect(dialog).not.toHaveAttribute('open')
	},
} satisfies Story

export const OperatorChangesTheirMind = {
	render: () => defineAureliaStory(publish),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Operator changes their mind"
		const canvas = within(canvasElement)
		const opener = canvas.getByRole('button', { name: '公開する' })

		// やめる
		await userEvent.click(opener)
		const dialog = await canvas.findByRole('dialog')
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'やめる' }),
		)
		await expect(dialog).not.toHaveAttribute('open')
		await expect(canvas.getByTestId('result')).toHaveTextContent('kept')
		await expect(document.activeElement).toBe(opener)

		// Escape
		await userEvent.click(opener)
		await waitFor(() => expect(dialog).toHaveAttribute('open'))
		await userEvent.keyboard('{Escape}')
		await expect(dialog).not.toHaveAttribute('open')
		await expect(canvas.getByTestId('result')).toHaveTextContent('kept')
		await expect(document.activeElement).toBe(opener)
	},
} satisfies Story

export const RevokeAScanner = {
	render: () =>
		defineAureliaStory(
			host(
				`<console-button variant="text" click.trigger="open('revoked')">受付1を取り消す</console-button>`,
				`<confirm-dialog component.ref="dialog" heading="受付1を取り消しますか？" confirm-label="取り消す" confirm-variant="danger">
					受付1を使っている端末は使えなくなります。
				</confirm-dialog>`,
			),
		),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Revoke a scanner"
		const canvas = within(canvasElement)
		await userEvent.click(
			canvas.getByRole('button', { name: '受付1を取り消す' }),
		)
		const dialog = await canvas.findByRole('dialog', {
			name: '受付1を取り消しますか？',
		})
		await expect(dialog).toHaveTextContent(
			'受付1を使っている端末は使えなくなります',
		)
		await expect(canvas.getByTestId('result')).toHaveTextContent('none')

		await userEvent.click(
			within(dialog).getByRole('button', { name: '取り消す' }),
		)
		await expect(canvas.getByTestId('result')).toHaveTextContent('revoked')
	},
} satisfies Story
