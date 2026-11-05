import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement } from 'aurelia'
import { expect, userEvent, within } from 'storybook/test'
import { ConfirmDialog } from './confirm-dialog'

const meta = {
	title: 'Components/ConfirmDialog',
	component: ConfirmDialog,
	argTypes: {
		heading: { control: 'text', description: 'The question asked.' },
		body: {
			control: 'text',
			description: 'What happens on confirm; a newline starts a new line.',
		},
		confirmLabel: { control: 'text', description: 'The confirm control.' },
		tone: {
			control: 'inline-radio',
			options: ['default', 'danger'],
			description: '`danger` for an action that cannot be undone.',
		},
	},
	args: {
		heading: 'サインアウトしますか？',
		body: '次に使うときは、パスキーでもう一度ログインします。',
		confirmLabel: 'サインアウト',
		tone: 'default',
	},
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

const template = `
	<confirm-dialog
		heading.bind="heading"
		body.bind="body"
		confirm-label.bind="confirmLabel"
		tone.bind="tone"
	></confirm-dialog>
`

const render: Story['render'] = (args) =>
	defineAureliaStory({ template, props: args, register: [ConfirmDialog] })

/** Open the dialog of the story and return its answer. */
function ask(canvasElement: HTMLElement): Promise<boolean> {
	const host = canvasElement.querySelector('confirm-dialog') as HTMLElement
	return CustomElement.for<ConfirmDialog>(host).viewModel.ask()
}

// Open with Cancel focused (the safe choice first); the confirm control
// answers true. Each story closes the dialog again so the modal does not
// inert the test harness for the next story.
export const Default = {
	render,
	play: async ({ canvasElement }) => {
		const answer = ask(canvasElement)
		const dialog = within(canvasElement).getByRole('dialog', {
			name: 'サインアウトしますか？',
		})
		await expect(dialog).toBeVisible()
		const cancel = within(dialog).getByRole('button', { name: 'キャンセル' })
		await expect(cancel).toHaveFocus()

		await userEvent.click(
			within(dialog).getByRole('button', { name: 'サインアウト' }),
		)
		await expect(await answer).toBe(true)
		await expect(dialog).not.toBeVisible()
	},
} satisfies Story

// The confirm control of an action that cannot be undone is coloured danger.
export const Danger = {
	render,
	args: {
		heading: 'アカウントを削除しますか？',
		body: '本人であることを確かめるため、もう一度パスキーでログインしていただきます。',
		confirmLabel: 'ログインして削除',
		tone: 'danger',
	},
	play: async ({ canvasElement }) => {
		const answer = ask(canvasElement)
		const dialog = within(canvasElement).getByRole('dialog')
		const confirm = within(dialog).getByRole('button', {
			name: 'ログインして削除',
		})
		await expect(confirm.getAttribute('data-variant')).toBe('danger')
		await userEvent.click(
			within(dialog).getByRole('button', { name: 'キャンセル' }),
		)
		await expect(await answer).toBe(false)
	},
} satisfies Story

// Escape closes the modal dialog natively and answers false. The story sends
// the close request Escape makes (`requestClose()`): a synthetic key event is
// untrusted and the browser does not act on it. The real key is pressed in the
// Settings e2e tests.
export const EscapeCancels = {
	render,
	play: async ({ canvasElement }) => {
		const answer = ask(canvasElement)
		const dialog = within(canvasElement).getByRole('dialog')
		await expect(
			within(dialog).getByRole('button', { name: 'キャンセル' }),
		).toHaveFocus()
		;(dialog as HTMLDialogElement & { requestClose(): void }).requestClose()
		await expect(await answer).toBe(false)
		await expect(dialog).not.toBeVisible()
	},
} satisfies Story

// The ticket-name confirmation: the new values on a line of their own, then
// what changes. The dialog is the top-most element at its centre even when a
// non-modal popover (a bottom sheet) is open under it.
export const OverAnOpenSheet = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<dialog popover="manual" class="story-sheet" ref="sheet">
					<p>Sheet content</p>
					${template}
				</dialog>
			`,
			props: args,
			register: [ConfirmDialog],
		}),
	args: {
		heading: '名義を変更しますか？',
		body: '鈴木 一郎 / 080-1111-2222\n保有中のチケットの券面もこの名義に変わります。',
		confirmLabel: '変更する',
	},
	play: async ({ canvasElement }) => {
		const sheet = canvasElement.querySelector<HTMLDialogElement>('.story-sheet')
		sheet?.showPopover()
		const answer = ask(canvasElement)
		const dialog = within(canvasElement).getByRole('dialog', {
			name: '名義を変更しますか？',
		})
		const box = dialog.getBoundingClientRect()
		const top = document.elementFromPoint(
			box.left + box.width / 2,
			box.top + box.height / 2,
		)
		await expect(dialog.contains(top)).toBe(true)

		await userEvent.click(
			within(dialog).getByRole('button', { name: 'キャンセル' }),
		)
		await expect(await answer).toBe(false)
		sheet?.hidePopover()
	},
} satisfies Story
