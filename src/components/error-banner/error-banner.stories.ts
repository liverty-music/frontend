import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { Registration } from 'aurelia'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
	type AppError,
	IErrorBoundaryService,
} from '../../services/error-boundary-service'
import { ErrorBanner } from './error-banner'

// The banner's text comes from the real catalog (ja), which the shared story
// annotations register, so the stories render what a fan sees.

// A stand-in error the banner renders. ErrorBanner reads `currentError`
// (drives the bottom-sheet open) plus report/URL helpers on the service.
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
		generateReport: fn(() => 'error report'),
		buildGitHubIssueUrl: fn(
			() => 'https://github.com/liverty-music/frontend/issues/new',
		),
	}
}

const meta = {
	title: 'Components/ErrorBanner',
	component: ErrorBanner,
	tags: ['test', 'autodocs'],
} satisfies Meta<typeof ErrorBanner>

export default meta
type Story = StoryObj<typeof meta>

// An active error opens the sheet and shows the fixed copy + error id, never
// the captured error's message.
export const WithError = {
	render: () =>
		defineAureliaStory({
			Component: ErrorBanner,
			items: [
				Registration.instance(
					IErrorBoundaryService,
					mockErrorBoundary(makeError()),
				),
			],
			register: [ErrorBanner],
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByText('問題が発生しました')).toBeInTheDocument()
		await expect(
			canvas.getByText(
				'予期しないエラーが発生しました。ページを再読み込みしてください。',
			),
		).toBeInTheDocument()
		await expect(canvas.getByText('ERR-12ab34cd')).toBeInTheDocument()
		await expect(
			canvas.queryByText(/Cannot read properties/),
		).not.toBeInTheDocument()
	},
} satisfies Story

// Clicking Dismiss delegates to the service's `dismiss()`. The service is
// module-scoped so the play function can assert against its spy.
const dismissService = mockErrorBoundary(makeError())

export const DismissInvokesService = {
	render: () =>
		defineAureliaStory({
			Component: ErrorBanner,
			items: [Registration.instance(IErrorBoundaryService, dismissService)],
			register: [ErrorBanner],
		}),
	play: async ({ canvasElement }) => {
		// The spy is module-scoped (so this play can assert on it), so reset its
		// call count first — a story replay/retry would otherwise accumulate calls
		// and break `toHaveBeenCalledOnce`.
		dismissService.dismiss.mockClear()
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: '閉じる' }))
		await expect(dismissService.dismiss).toHaveBeenCalledOnce()
	},
} satisfies Story
