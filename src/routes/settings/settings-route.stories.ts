import { IRouter } from '@aurelia/router'
import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { Registration } from 'aurelia'
import { expect, waitFor } from 'storybook/test'
import { ILocalStorage } from '../../adapter/storage/local-storage'
import { ConfirmDialog } from '../../components/confirm-dialog/confirm-dialog'
import { ListItem } from '../../components/list-item/list-item'
import { SettingsConsentRow } from '../../components/settings-consent-row/settings-consent-row'
import { SettingsStatusRow } from '../../components/settings-status-row/settings-status-row'
import { SettingsSwitchRow } from '../../components/settings-switch-row/settings-switch-row'
import { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { IAppConfig } from '../../config/app-config'
import { IConsentService } from '../../lib/consent/consent-service'
import { IAudioEngine } from '../../services/audio-engine'
import { IAuthService } from '../../services/auth-service'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { IFabMenuService } from '../../services/fab-menu-service'
import { IIdentityVerificationService } from '../../services/identity-verification-service'
import { IPushService } from '../../services/push-service'
import { IUserStore } from '../../services/user-store'
import { SettingsRoute } from './settings-route'

// A route story: every store and service the route resolves is a fake
// registered through `items`, so nothing reaches the network (AGENTS.md,
// "Route stories"). It renders the route's own layout, the grid track and the
// scroll container inside it, which no component story shows.

const items = [
	Registration.instance(IAuthService, {
		isAuthenticated: false,
		emailVerified: false,
		refreshEmailVerified: async () => {},
	}),
	Registration.instance(IUserStore, {
		currentLanguage: 'ja',
		currentHome: null,
		current: undefined,
	}),
	Registration.instance(ILocalStorage, {}),
	Registration.instance(IPushService, {
		resolvePushState: async () => 'disabled',
	}),
	Registration.instance(IErrorBoundaryService, {}),
	Registration.instance(IRouter, { load: async () => true }),
	Registration.instance(IAudioEngine, { muted: false, volume: 1 }),
	Registration.instance(IAppConfig, { vapidPublicKey: '' }),
	Registration.instance(IIdentityVerificationService, {
		current: undefined,
		failure: null,
		get: async () => undefined,
		takeVerifiedNotice: () => false,
	}),
	Registration.instance(IConsentService, {
		analytics: true,
		sessionReplay: true,
	}),
	Registration.instance(IFabMenuService, { isLeftHanded: false }),
]

const register = [
	SettingsRoute,
	ListItem,
	SettingsSwitchRow,
	SettingsConsentRow,
	SettingsStatusRow,
	UserHomeSelector,
	ConfirmDialog,
]

const meta = {
	title: 'Routes/Settings',
	component: SettingsRoute,
	globals: { viewport: { value: 'mobile1', isRotated: false } },
	parameters: {
		a11y: {
			config: {
				// The route's scroll container is reached by keyboard through the
				// controls inside it.
				rules: [{ id: 'scrollable-region-focusable', enabled: false }],
			},
		},
	},
} satisfies Meta<typeof SettingsRoute>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The guest's Settings in a box shorter than its content, as the area between
 * the shell's header and bottom bar is on a small phone: the content is
 * taller than the box, so the scroll container must engage.
 */
export const ShortScreen = {
	render: () =>
		defineAureliaStory({
			template:
				'<div style="display: grid; block-size: 24rem"><settings-route></settings-route></div>',
			register,
			items,
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/route/settings "Content track item can shrink"
		const route = await waitFor(() => {
			const el = canvasElement.querySelector<HTMLElement>('settings-route')
			if (!el?.querySelector('[data-testid="settings-scroll"]'))
				throw new Error('route not rendered yet')
			return el
		})
		const main = route.querySelector<HTMLElement>('main')
		const scroll = route.querySelector<HTMLElement>(
			'[data-testid="settings-scroll"]',
		)
		if (!main || !scroll) throw new Error('layout not rendered')
		await expect(getComputedStyle(main).minBlockSize).toBe('0px')
		await expect(getComputedStyle(scroll).overflowY).toBe('auto')
		// The grid item stays inside the route box instead of growing to the
		// content's full height, and the scroll container takes the overflow.
		await expect(main.getBoundingClientRect().height).toBeLessThanOrEqual(
			route.getBoundingClientRect().height + 1,
		)
		await expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight)
	},
} satisfies Story
