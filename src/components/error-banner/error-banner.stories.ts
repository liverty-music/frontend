import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { IWindow, Registration } from 'aurelia'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
	type AppError,
	IErrorBoundaryService,
} from '../../services/error-boundary-service'
import { ErrorBanner } from './error-banner'

// The banner's text comes from the real catalog (ja), which the shared story
// annotations register, so the stories render what a fan sees.

const MAILTO = 'mailto:pannpers@pannpers.dev?subject=test'

// A stand-in error the banner renders. ErrorBanner reads `currentError`
// (drives the bottom-sheet open) plus the report email link on the service.
function makeError(overrides: Partial<AppError> = {}): AppError {
	return {
		id: 'ERR-12ab34cd',
		message: "Cannot read properties of undefined (reading 'id')",
		...overrides,
	} as AppError
}

function mockErrorBoundary(error: AppError | null) {
	return {
		currentError: error,
		captureError: fn(),
		addBreadcrumb: fn(),
		dismiss: fn(),
		buildReportMailto: fn(() => MAILTO),
	}
}

// The banner opens the mail app and reloads through IWindow; a stand-in
// keeps the story page where it is.
function mockWindow() {
	return { location: { href: '', reload: fn() } }
}

const meta = {
	title: 'Components/ErrorBanner',
	component: ErrorBanner,
	tags: ['test', 'autodocs'],
} satisfies Meta<typeof ErrorBanner>

export default meta
type Story = StoryObj<typeof meta>

// An open banner: the fixed copy and the three actions, email first. Neither
// the error's message nor its Error ID is shown.
export const Default = {
	render: () =>
		defineAureliaStory({
			Component: ErrorBanner,
			items: [
				Registration.instance(
					IErrorBoundaryService,
					mockErrorBoundary(makeError()),
				),
				Registration.instance(IWindow, mockWindow()),
			],
			register: [ErrorBanner],
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByText('⚡️ライブ中にアクシデント発生⚡️'),
		).toBeInTheDocument()
		await expect(
			canvas.getByText(/^ですが、ご安心ください！/),
		).toBeInTheDocument()
		await expect(
			canvas.getAllByRole('button').map((b) => b.textContent?.trim()),
		).toEqual(['メールで状況を伝える', 'ページを読み込み直す', '閉じる'])
		await expect(canvas.queryByText('ERR-12ab34cd')).not.toBeInTheDocument()
		await expect(
			canvas.queryByText(/Cannot read properties/),
		).not.toBeInTheDocument()
		await expect(
			canvas.queryByText(/pannpers@pannpers\.dev/),
		).not.toBeInTheDocument()
	},
} satisfies Story

// After the email tap: the contact address, for a device that opens no mail
// app.
export const AfterEmailTap = {
	name: 'After email tap',
	render: () =>
		defineAureliaStory({
			Component: ErrorBanner,
			items: [
				Registration.instance(
					IErrorBoundaryService,
					mockErrorBoundary(makeError()),
				),
				Registration.instance(IWindow, mockWindow()),
			],
			register: [ErrorBanner],
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(
			canvas.getByRole('button', { name: 'メールで状況を伝える' }),
		)
		await expect(
			canvas.getByText(
				'メールが開かない場合は、pannpers@pannpers.dev までご連絡ください。',
			),
		).toBeInTheDocument()
	},
} satisfies Story

// Every button responds to a click. The service and window are module-scoped
// so the play function can assert against their spies.
const interactiveService = mockErrorBoundary(makeError())
const interactiveWindow = mockWindow()

export const ButtonsAreInteractive = {
	render: () =>
		defineAureliaStory({
			Component: ErrorBanner,
			items: [
				Registration.instance(IErrorBoundaryService, interactiveService),
				Registration.instance(IWindow, interactiveWindow),
			],
			register: [ErrorBanner],
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/error-banner "Error banner buttons are interactive"
		// The spies are module-scoped, so reset them first — a story
		// replay/retry would otherwise accumulate calls.
		interactiveService.dismiss.mockClear()
		interactiveService.buildReportMailto.mockClear()
		interactiveWindow.location.reload.mockClear()
		interactiveWindow.location.href = ''
		const canvas = within(canvasElement)
		// The dialog overrides the `pointer-events: none` of its host.
		const dialog = canvasElement.querySelector('dialog')
		await expect(dialog).not.toBeNull()
		await expect(getComputedStyle(dialog as Element).pointerEvents).toBe('auto')

		// Real clicks: they reach the buttons only when the backdrop lets them.
		await userEvent.click(
			canvas.getByRole('button', { name: 'メールで状況を伝える' }),
		)
		await expect(interactiveWindow.location.href).toBe(MAILTO)

		await userEvent.click(
			canvas.getByRole('button', { name: 'ページを読み込み直す' }),
		)
		await expect(interactiveWindow.location.reload).toHaveBeenCalledOnce()

		await userEvent.click(canvas.getByRole('button', { name: '閉じる' }))
		await expect(interactiveService.dismiss).toHaveBeenCalledOnce()
	},
} satisfies Story
