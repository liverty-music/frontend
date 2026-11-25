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
import {
	finishMotion,
	pausableAnimations,
	seekMotion,
} from '../../../.storybook/motion'
import {
	consoleStoryParameters,
	transitionsEnded,
} from '../../ui/story-support'
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

/**
 * The menu fades in over 200 ms when it opens and fades out when it closes,
 * after which it is not rendered. The story opens and closes it and steps
 * through each fade.
 */
export const OpensAndClosesWithAFade = {
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/organizer-shell "Opening and closing the account menu"
		const menu = canvasElement.querySelector<HTMLElement>('.account-menu')
		if (!menu) throw new Error('menu not rendered')
		const fadeOf = () =>
			pausableAnimations(menu).filter(
				(a) =>
					a instanceof CSSTransition &&
					a.transitionProperty === 'opacity' &&
					a.effect?.target === menu,
			)
		const opacity = () => Number.parseFloat(getComputedStyle(menu).opacity)

		// Caught at once, before any frame: a loaded runner can outlast a 200 ms fade.
		menu.showPopover()
		const fadeIn = fadeOf()
		await expect(fadeIn).toHaveLength(1)
		await expect(Number(fadeIn[0].effect?.getComputedTiming().duration)).toBe(
			200,
		)
		await seekMotion(fadeIn, 0)
		await expect(opacity()).toBeLessThan(0.1)
		await seekMotion(fadeIn, 0.1)
		await expect(opacity()).toBeGreaterThan(0.05)
		await expect(opacity()).toBeLessThan(1)
		finishMotion(fadeIn)
		await transitionsEnded(menu)
		await expect(opacity()).toBe(1)

		menu.hidePopover()
		const fadeOut = fadeOf()
		await expect(fadeOut).toHaveLength(1)
		await seekMotion(fadeOut, 0.1)
		await expect(opacity()).toBeLessThan(1)
		finishMotion(fadeOut)
		await waitFor(() => expect(getComputedStyle(menu).display).toBe('none'))
	},
} satisfies Story
