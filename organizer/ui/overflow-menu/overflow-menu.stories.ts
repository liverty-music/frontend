import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor } from 'storybook/test'
import { userEvent } from 'vitest/browser'
import {
	canvasOf,
	consoleStoryParameters,
	deepQuery,
	focusedElement,
} from '../story-support'
import { type MenuItem, OverflowMenu } from './overflow-menu'

const meta = {
	title: 'Console/OverflowMenu',
	component: OverflowMenu,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		labelKey: {
			control: 'text',
			description: 'Catalog key of the button’s name (その他の操作).',
		},
	},
} satisfies Meta<typeof OverflowMenu>

export default meta
type Story = StoryObj<typeof meta>

const ITEMS: MenuItem[] = [
	{ id: 'cancel', labelKey: 'event.cancel' },
	{ id: 'edit', labelKey: 'event.editConcert', href: '#edit' },
]

const render =
	(items: MenuItem[]): Story['render'] =>
	() =>
		defineAureliaStory({
			template: `
				<div style="display:flex; justify-content:flex-end; padding:16px; min-block-size:200px; background:var(--md-color-surface); color:var(--md-color-on-surface)">
					<overflow-menu items.bind="items" select.trigger="chosen = $event.detail"></overflow-menu>
				</div>
				<output data-testid="chosen">\${chosen}</output>
			`,
			props: { items, chosen: 'none' },
		})

const menuOf = (canvasElement: HTMLElement) =>
	deepQuery(canvasElement, '[role="menu"]')

/** Closed: one 48 px icon button named その他の操作. */
export const Closed = {
	render: render(ITEMS),
	play: async ({ canvasElement }) => {
		const button = canvasOf(canvasElement)
			.getByRole('button', { name: 'その他の操作' })
			.element()
		const box = button.getBoundingClientRect()
		await expect(box.width).toBe(48)
		await expect(box.height).toBe(48)
		await expect(button).toHaveAttribute('aria-haspopup', 'menu')
		await expect(button).toHaveAttribute('aria-expanded', 'false')
		await expect(menuOf(canvasElement).matches(':popover-open')).toBe(false)
	},
} satisfies Story

/**
 * Opening moves focus to the first item; the arrow keys move between items;
 * Escape closes the menu and returns focus to its button.
 */
export const OpenAndClose = {
	render: render(ITEMS),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		const button = canvas
			.getByRole('button', { name: 'その他の操作' })
			.element()
		await userEvent.click(button)
		const menu = canvas.getByRole('menu', { name: 'その他の操作' })
		await waitFor(() => expect(menu.element()).toBeVisible())
		await expect(button).toHaveAttribute('aria-expanded', 'true')
		await waitFor(() => expect(focusedElement()).toHaveTextContent('中止する'))
		const items = menu.getByRole('menuitem').elements()
		await expect(items.map((i) => i.textContent?.trim())).toEqual([
			'中止する',
			'公演を編集',
		])
		for (const item of items) {
			await expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(
				48,
			)
		}

		await userEvent.keyboard('{ArrowDown}')
		await expect(focusedElement()).toHaveTextContent('公演を編集')
		await userEvent.keyboard('{ArrowDown}')
		await expect(focusedElement()).toHaveTextContent('中止する')

		await userEvent.keyboard('{Escape}')
		await waitFor(() =>
			expect(menuOf(canvasElement).matches(':popover-open')).toBe(false),
		)
		await expect(focusedElement()).toBe(button)
	},
} satisfies Story

/** Choosing an action closes the menu and dispatches `select` with its id. */
export const ChooseAnAction = {
	render: render(ITEMS),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		const button = canvas
			.getByRole('button', { name: 'その他の操作' })
			.element()
		await userEvent.click(button)
		await userEvent.click(canvas.getByRole('menuitem', { name: '中止する' }))
		await waitFor(() =>
			expect(canvas.getByTestId('chosen').element()).toHaveTextContent(
				'cancel',
			),
		)
		await expect(menuOf(canvasElement).matches(':popover-open')).toBe(false)
		await expect(focusedElement()).toBe(button)
	},
} satisfies Story

/** An unavailable item stays in the menu, dimmed, and does nothing. */
export const DisabledItem = {
	render: render([
		{ id: 'cancel', labelKey: 'concert.cancelConcert', disabled: true },
		{ id: 'edit', labelKey: 'event.editConcert', href: '#edit' },
	]),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: 'その他の操作' }))
		const disabled = canvas
			.getByRole('menuitem', { name: '公演を中止' })
			.element()
		await waitFor(() => expect(disabled).toBeVisible())
		await expect(disabled).toHaveAttribute('aria-disabled', 'true')
		// Focus starts on the first item that can be chosen.
		await waitFor(() =>
			expect(focusedElement()).toHaveTextContent('公演を編集'),
		)
		// A pointer cannot press it (the browser reports it disabled); a
		// click event reaching it does nothing either.
		disabled.click()
		await expect(canvas.getByTestId('chosen').element()).toHaveTextContent(
			'none',
		)
		await expect(menuOf(canvasElement).matches(':popover-open')).toBe(true)
		await userEvent.keyboard('{Escape}')
	},
} satisfies Story
