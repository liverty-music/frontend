import { I18N } from '@aurelia/i18n'
import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement } from 'aurelia'
import { expect, waitFor } from 'storybook/test'
import { userEvent } from 'vitest/browser'
import {
	canvasOf,
	consoleStoryParameters,
	deepQuery,
	focusedElement,
	roleColor,
} from '../story-support'
import { ConfirmDialog } from './confirm-dialog'

const meta = {
	title: 'Console/ConfirmDialog',
	component: ConfirmDialog,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		headingKey: { control: 'text', description: 'Catalog key of the title.' },
		confirmKey: {
			control: 'text',
			description: 'Catalog key of the confirming button.',
		},
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

/** Text and background of the control inside the named dialog button. */
function lookOf(button: Element): { color: string; background: string } {
	const style = getComputedStyle(deepQuery(button, 'button'))
	return { color: style.color, background: style.backgroundColor }
}

const publish = host(
	`<console-button variant="filled" click.trigger="open('published')">公開する</console-button>`,
	`<confirm-dialog component.ref="dialog" heading-key="event.publishConfirmTitle" heading-params.bind="{ title: 'XX Tour 2026' }" confirm-key="event.publish">
		この公演日だけを公開し、出演者のフォロワーに通知します。公開すると下書きには戻せません。
	</confirm-dialog>`,
)

export const PublishAsksFirst = {
	render: () => defineAureliaStory(publish),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Publish asks first"
		const canvas = canvasOf(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: '公開する' }))

		const dialog = canvas.getByRole('dialog', {
			name: 'XX Tour 2026 のこの公演日を公開しますか？',
		})
		await waitFor(() => expect(dialog.element()).toBeVisible())
		// The dialog sits in the middle of the viewport, not stuck to its top
		// (the shared reset zeroes the margin a modal dialog centres with).
		const box = dialog.element().getBoundingClientRect()
		await expect(
			Math.abs(box.top - (window.innerHeight - box.bottom)),
		).toBeLessThanOrEqual(2)
		await expect(
			Math.abs(box.left - (window.innerWidth - box.right)),
		).toBeLessThanOrEqual(2)
		// The body is the page's own content, shown through the dialog's slot.
		const body = canvasElement.querySelector('confirm-dialog')
		await expect(body).toHaveTextContent('フォロワーに通知します')
		await expect(body).toHaveTextContent('下書きには戻せません')
		await expect(canvas.getByTestId('result').element()).toHaveTextContent(
			'none',
		)
		// The dialog takes focus, on its safe choice.
		await expect(focusedElement()).toBe(
			dialog.getByRole('button', { name: 'やめる' }).element(),
		)
		// やめる is a neutral text button; the confirming 公開する keeps its
		// emphasis as the dialog's one filled button, in the brand color.
		const page = canvasElement.querySelector<HTMLElement>('div')
		if (!page) throw new Error('page not rendered')
		const dismiss = lookOf(
			deepQuery(dialog.element(), 'console-button:not([data-role])'),
		)
		await expect(dismiss.color).toBe(
			roleColor(page, '--md-color-on-surface-variant'),
		)
		await expect(
			lookOf(deepQuery(dialog.element(), 'console-button[data-role="confirm"]'))
				.background,
		).toBe(roleColor(page, '--md-color-primary'))

		await userEvent.click(dialog.getByRole('button', { name: '公開する' }))

		await expect(canvas.getByTestId('result').element()).toHaveTextContent(
			'published',
		)
		await expect(dialog.query()).toBeNull()
	},
} satisfies Story

export const OperatorChangesTheirMind = {
	render: () => defineAureliaStory(publish),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Operator changes their mind"
		const canvas = canvasOf(canvasElement)
		const opener = canvas.getByRole('button', { name: '公開する' }).element()
		const dialog = canvas.getByRole('dialog')

		// やめる
		await userEvent.click(opener)
		await waitFor(() => expect(dialog.element()).toBeVisible())
		await userEvent.click(dialog.getByRole('button', { name: 'やめる' }))
		await expect(dialog.query()).toBeNull()
		await expect(canvas.getByTestId('result').element()).toHaveTextContent(
			'kept',
		)
		await expect(focusedElement()).toBe(opener)

		// Escape
		await userEvent.click(opener)
		await waitFor(() => expect(dialog.element()).toBeVisible())
		await userEvent.keyboard('{Escape}')
		await waitFor(() => expect(dialog.query()).toBeNull())
		await expect(canvas.getByTestId('result').element()).toHaveTextContent(
			'kept',
		)
		await expect(focusedElement()).toBe(opener)
	},
} satisfies Story

export const RevokeAScanner = {
	render: () =>
		defineAureliaStory(
			host(
				`<console-button variant="text" click.trigger="open('revoked')">受付1を取り消す</console-button>`,
				`<confirm-dialog component.ref="dialog" heading-key="reception.revokeConfirmTitle" heading-params.bind="{ number: 1 }" confirm-key="reception.revoke" confirm-variant="danger">
					受付1を使っている端末は使えなくなります。
				</confirm-dialog>`,
			),
		),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Revoke a scanner"
		const canvas = canvasOf(canvasElement)
		await userEvent.click(
			canvas.getByRole('button', { name: '受付1を取り消す' }),
		)
		const dialog = canvas.getByRole('dialog', {
			name: '受付1を取り消しますか？',
		})
		await waitFor(() => expect(dialog.element()).toBeVisible())
		await expect(
			canvasElement.querySelector('confirm-dialog'),
		).toHaveTextContent('受付1を使っている端末は使えなくなります')
		await expect(canvas.getByTestId('result').element()).toHaveTextContent(
			'none',
		)
		// The destructive confirm stands apart from the neutral やめる by the
		// error container, not by the brand color.
		const page = canvasElement.querySelector<HTMLElement>('div')
		if (!page) throw new Error('page not rendered')
		const brand = roleColor(page, '--md-color-primary')
		const dismiss = lookOf(
			deepQuery(dialog.element(), 'console-button:not([data-role])'),
		)
		const confirm = lookOf(
			deepQuery(dialog.element(), 'console-button[data-role="confirm"]'),
		)
		await expect([dismiss.color, dismiss.background]).not.toContain(brand)
		await expect([confirm.color, confirm.background]).not.toContain(brand)
		await expect(confirm.background).toBe(roleColor(page, '--md-color-error'))

		await userEvent.click(dialog.getByRole('button', { name: '取り消す' }))
		await expect(canvas.getByTestId('result').element()).toHaveTextContent(
			'revoked',
		)
	},
} satisfies Story

/** The dismissive button reads Cancel in English, not "Keep as is". */
export const DismissInEnglish = {
	render: () => defineAureliaStory(publish),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Operator changes their mind"
		const host = canvasElement.querySelector('confirm-dialog')
		if (!host) throw new Error('confirm-dialog not rendered')
		const i18n = CustomElement.for(host).container.get(I18N)
		await i18n.setLocale('en')
		try {
			const canvas = canvasOf(canvasElement)
			await userEvent.click(canvas.getByRole('button', { name: '公開する' }))
			const dialog = canvas.getByRole('dialog')
			await waitFor(() => expect(dialog.element()).toBeVisible())
			await expect(
				dialog.getByRole('button', { name: 'Cancel', exact: true }).element(),
			).toBeVisible()
			await expect(
				dialog.getByRole('button', { name: /Keep as is/ }).query(),
			).toBeNull()
			await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
			await expect(canvas.getByTestId('result').element()).toHaveTextContent(
				'kept',
			)
		} finally {
			// The catalog instance may outlive this story.
			await i18n.setLocale('ja')
		}
	},
} satisfies Story
