import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { Registration } from 'aurelia'
import { expect, waitFor } from 'storybook/test'
import { userEvent } from 'vitest/browser'
import { IAuthService } from '../../../shared/services/auth-service'
import { IConsoleLanguage } from '../../i18n/console-language'
import { consoleStoryParameters } from '../../ui/story-support'
import { AccountMenu } from './account-menu'

const meta = {
	title: 'Console/Shell/AccountMenu',
	component: AccountMenu,
	parameters: consoleStoryParameters,
} satisfies Meta<typeof AccountMenu>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = () =>
	defineAureliaStory({
		template: `
			<div style="display:flex; justify-content:flex-end; min-block-size:240px; padding:8px; --top-app-bar-block-size:64px; background:var(--md-sys-color-surface)">
				<account-menu></account-menu>
			</div>
		`,
		register: [AccountMenu],
		items: [
			Registration.instance(IConsoleLanguage, {
				current: 'ja',
				set: async () => {},
			}),
			Registration.instance(IAuthService, { signOut: async () => {} }),
		],
	})

const buttonOf = (canvasElement: HTMLElement): HTMLButtonElement => {
	const button = canvasElement.querySelector<HTMLButtonElement>(
		'[popovertarget="account-menu"]',
	)
	if (!button) throw new Error('account button not rendered')
	return button
}

/** Closed: the account icon button. */
export const Closed = {
	render,
	play: async ({ canvasElement }) => {
		await expect(buttonOf(canvasElement).getAttribute('aria-label')).toBe(
			'アカウント',
		)
	},
} satisfies Story

/** Open: the languages, the one shown checked, then サインアウト. */
export const Open = {
	render,
	play: async ({ canvasElement }) => {
		await userEvent.click(buttonOf(canvasElement))
		const menu = canvasElement.querySelector<HTMLElement>('.account-menu')
		await waitFor(() => expect(menu?.matches(':popover-open')).toBe(true))
		const pressed = canvasElement.querySelector<HTMLElement>(
			'[aria-pressed="true"] .menu-check',
		)
		if (!pressed) throw new Error('no language is marked')
		await expect(getComputedStyle(pressed).visibility).toBe('visible')
	},
} satisfies Story
