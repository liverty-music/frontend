import { I18N } from '@aurelia/i18n'
import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement } from 'aurelia'
import { expect, waitFor, within } from 'storybook/test'
import { page, userEvent } from 'vitest/browser'
import { consoleStoryParameters, deepQueryAll } from '../story-support'
import { ConsoleSnackbar } from './console-snackbar'
import { ISnackbar } from './snackbar'

const meta = {
	title: 'Console/ConsoleSnackbar',
	component: ConsoleSnackbar,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
} satisfies Meta<typeof ConsoleSnackbar>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = () =>
	defineAureliaStory({
		template: `
			<main style="min-block-size:100vh; background:var(--md-color-surface); color:var(--md-color-on-surface)">
				<nav data-testid="nav-bar" style="position:fixed; inset-inline:0; inset-block-end:0; block-size:80px; background:var(--md-color-surface-container)" aria-label="ナビゲーション"></nav>
				<console-snackbar></console-snackbar>
			</main>
		`,
	})

/** The console's snackbar service, from the story app's container. */
function snackbarOf(root: HTMLElement): ISnackbar {
	const host = root.querySelector('console-snackbar')
	if (!host) throw new Error('host not rendered')
	return CustomElement.for(host).container.get(ISnackbar)
}

/** The snacks currently open (popovers shown). */
function openSnacks(root: HTMLElement): HTMLElement[] {
	return deepQueryAll(root, '.snack-item').filter((el) =>
		el.matches(':popover-open'),
	)
}

export const TwoResultsInARow = {
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/snack-bar "Two results in a row"
		const snackbar = snackbarOf(canvasElement)
		snackbar.show('concertEditor.saved')
		await waitFor(() => expect(openSnacks(canvasElement)).toHaveLength(1))
		snackbar.show('common.copied')

		await waitFor(() => {
			const open = openSnacks(canvasElement)
			expect(open).toHaveLength(1)
			expect(open[0]).toHaveTextContent('コピーしました')
		})
		// Announced without taking focus.
		await expect(openSnacks(canvasElement)[0]).toHaveAttribute('role', 'status')
		await expect(canvasElement.contains(document.activeElement)).toBe(false)
		// Fully shown before the page is checked: mid fade, its colors blend.
		await waitFor(() =>
			expect(getComputedStyle(openSnacks(canvasElement)[0]).opacity).toBe('1'),
		)
	},
} satisfies Story

export const PhoneLayout = {
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/snack-bar "Phone layout"
		await page.viewport(390, 844)
		snackbarOf(canvasElement).show('concertEditor.saved')
		await waitFor(() => expect(openSnacks(canvasElement)).toHaveLength(1))
		const nav = within(canvasElement)
			.getByTestId('nav-bar')
			.getBoundingClientRect()
		await waitFor(() =>
			expect(
				openSnacks(canvasElement)[0].getBoundingClientRect().bottom,
			).toBeLessThanOrEqual(nav.top),
		)
		// Fully shown before the page is checked: mid fade, its colors blend.
		await waitFor(() =>
			expect(getComputedStyle(openSnacks(canvasElement)[0]).opacity).toBe('1'),
		)
	},
} satisfies Story

export const SaveSucceeded = {
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/snack-bar "Save succeeded"
		const shownAt = performance.now()
		snackbarOf(canvasElement).show('concertEditor.saved')
		await waitFor(() =>
			expect(openSnacks(canvasElement)[0]).toHaveTextContent(
				'変更を保存しました',
			),
		)
		await waitFor(() =>
			expect(
				within(openSnacks(canvasElement)[0]).getByRole('button', {
					name: '閉じる',
				}),
			).toBeVisible(),
		)

		await waitFor(() => expect(openSnacks(canvasElement)).toHaveLength(0), {
			timeout: 6000,
		})
		const shownFor = performance.now() - shownAt
		await expect(shownFor).toBeGreaterThan(3500)
		await expect(shownFor).toBeLessThan(5500)
	},
} satisfies Story

export const SaveFailed = {
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/snack-bar "Save failed"
		snackbarOf(canvasElement).showError('concertEditor.saveFailed', {
			retry: () => {},
		})
		await waitFor(() => expect(openSnacks(canvasElement)).toHaveLength(1))
		const snack = openSnacks(canvasElement)[0]
		await expect(snack).toHaveTextContent('保存できませんでした')
		await waitFor(() =>
			expect(
				within(snack).getByRole('button', { name: '再試行' }),
			).toBeVisible(),
		)

		// Still shown well past the 4 s of a success message.
		await new Promise((resolve) => setTimeout(resolve, 5000))
		await expect(openSnacks(canvasElement)).toHaveLength(1)

		// Closed only by the member.
		await userEvent.click(within(snack).getByRole('button', { name: '閉じる' }))
		await waitFor(() => expect(openSnacks(canvasElement)).toHaveLength(0))
	},
} satisfies Story

export const MemberRetries = {
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/snack-bar "Member retries"
		let retries = 0
		snackbarOf(canvasElement).showError('concertEditor.saveFailed', {
			retry: () => {
				retries++
			},
		})
		await waitFor(() => expect(openSnacks(canvasElement)).toHaveLength(1))

		await userEvent.click(
			within(openSnacks(canvasElement)[0]).getByRole('button', {
				name: '再試行',
			}),
		)

		await expect(retries).toBe(1)
		await waitFor(() => expect(openSnacks(canvasElement)).toHaveLength(0))
	},
} satisfies Story

/**
 * A message shown while the language changes follows the switch (snack-bar
 * requirement; the requirement has no scenario of its own).
 */
export const FollowsALanguageSwitch = {
	render,
	play: async ({ canvasElement }) => {
		const host = canvasElement.querySelector('console-snackbar')
		if (!host) throw new Error('host not rendered')
		const i18n = CustomElement.for(host).container.get(I18N)
		snackbarOf(canvasElement).showError('concertEditor.saveFailed', {
			retry: () => {},
		})
		await waitFor(() =>
			expect(openSnacks(canvasElement)[0]).toHaveTextContent(
				'保存できませんでした',
			),
		)
		// No icon: the message is text.
		await expect(
			openSnacks(canvasElement)[0].querySelector('svg-icon'),
		).toBeNull()

		await i18n.setLocale('en')
		try {
			await waitFor(() => {
				expect(openSnacks(canvasElement)[0]).toHaveTextContent('Could not save')
				expect(openSnacks(canvasElement)[0]).toHaveTextContent('Retry')
			})
		} finally {
			await i18n.setLocale('ja')
		}
		// Fully shown before the page is checked: mid fade, its colors blend.
		await waitFor(() =>
			expect(getComputedStyle(openSnacks(canvasElement)[0]).opacity).toBe('1'),
		)
	},
} satisfies Story
