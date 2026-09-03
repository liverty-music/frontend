import { I18N } from '@aurelia/i18n'
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

// Minimal I18N stand-in: ErrorBanner only calls `i18n.tr(key)`. Registering it
// directly avoids pulling the full I18nConfiguration into the story container
// (the component resolves I18N at construction time via `resolve(I18N)`).
const i18nMock = { tr: (key: string) => key } as unknown as I18N

// A stand-in error the banner renders. ErrorBanner reads `currentError`
// (drives the bottom-sheet open) plus report/URL helpers on the service.
function makeError(overrides: Partial<AppError> = {}): AppError {
	return {
		id: 'ERR-12ab34cd',
		message: '予期しないエラーが発生しました',
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

// An active error opens the sheet and shows the message + error id.
export const WithError = {
	render: () =>
		defineAureliaStory({
			Component: ErrorBanner,
			items: [
				Registration.instance(
					IErrorBoundaryService,
					mockErrorBoundary(makeError()),
				),
				Registration.instance(I18N, i18nMock),
			],
			register: [ErrorBanner],
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByText('予期しないエラーが発生しました'),
		).toBeInTheDocument()
		await expect(canvas.getByText('ERR-12ab34cd')).toBeInTheDocument()
	},
} satisfies Story

// Clicking Dismiss delegates to the service's `dismiss()`. The service is
// module-scoped so the play function can assert against its spy.
const dismissService = mockErrorBoundary(makeError())

export const DismissInvokesService = {
	render: () =>
		defineAureliaStory({
			Component: ErrorBanner,
			items: [
				Registration.instance(IErrorBoundaryService, dismissService),
				Registration.instance(I18N, i18nMock),
			],
			register: [ErrorBanner],
		}),
	play: async ({ canvasElement }) => {
		// The spy is module-scoped (so this play can assert on it), so reset its
		// call count first — a story replay/retry would otherwise accumulate calls
		// and break `toHaveBeenCalledOnce`.
		dismissService.dismiss.mockClear()
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }))
		await expect(dismissService.dismiss).toHaveBeenCalledOnce()
	},
} satisfies Story
