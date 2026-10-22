import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDocumentLocation } from '../../src/adapter/browser/document-location'
import { ILocalStorage } from '../../src/adapter/storage/local-storage'
import { AddPasskeyPrompt } from '../../src/components/add-passkey-prompt/add-passkey-prompt'
import { IAppConfig } from '../../src/config/app-config'
import { StorageKeys } from '../../src/constants/storage-keys'
import ja from '../../src/locales/ja/translation.json'
import {
	ADD_PASSKEY_LATER_MS,
	IAddPasskeyPromptService,
} from '../../src/services/add-passkey-prompt-service'
import { IAuthService } from '../../src/services/auth-service'
import { IPromptCoordinator } from '../../src/services/prompt-coordinator'
import { createMockAppConfig } from '../helpers/mock-app-config'

const DAY_MS = 24 * 60 * 60 * 1000

/** The bottom sheet, reduced to showing its content while open. */
const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<div if.bind="open"><au-slot></au-slot></div>',
		bindables: ['open', 'ariaLabel'],
	},
	class {},
)

function memoryStorage(seed: Record<string, string> = {}) {
	const map = new Map(Object.entries(seed))
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => {
			map.set(k, v)
		},
		removeItem: (k: string) => {
			map.delete(k)
		},
		removeByPrefix: () => {},
	}
}

/**
 * Renders the prompt as a new app session on one device whose storage is
 * `storage`, and runs the Log In hand-off the auth callback runs.
 */
async function logInOn(storage: ReturnType<typeof memoryStorage>) {
	const location = { assign: vi.fn() }
	const fixture = await createFixture
		.html('<add-passkey-prompt></add-passkey-prompt>')
		.deps(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng: 'ja',
					resources: { ja: { translation: ja } },
					fallbackLng: 'ja',
				}
			}),
			Registration.instance(ILocalStorage, storage),
			Registration.instance(IDocumentLocation, location),
			Registration.instance(IAppConfig, createMockAppConfig()),
			Registration.instance(IAuthService, {
				isAuthenticated: true,
				user: { profile: { sub: 'zitadel-user-1', email: 'fan@example.com' } },
			}),
			BottomSheetStub,
			AddPasskeyPrompt,
		)
		.build().started
	const prompt = fixture.container.get(IAddPasskeyPromptService)
	prompt.offerAfterLogIn()
	await tasksSettled()

	const host = fixture.appHost
	const shown = () => host.querySelector('[data-testid="add-passkey-prompt"]')
	const click = async (testId: string) => {
		host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click()
		await tasksSettled()
	}
	return { fixture, prompt, location, shown, click }
}

describe('Add-passkey prompt', () => {
	afterEach(() => {
		vi.useRealTimers()
		sessionStorage.clear()
	})

	it('shows the three choices after a Log In on a device without the record', async () => {
		const { shown } = await logInOn(memoryStorage())
		expect(shown()?.textContent).toContain(ja.addPasskeyPrompt.create)
		expect(shown()?.textContent).toContain(ja.addPasskeyPrompt.alreadyHasOne)
		expect(shown()?.textContent).toContain(ja.addPasskeyPrompt.later)
	})

	it('stays hidden after "Later" chosen 10 days ago', async () => {
		// @spec components/infrastructure/fan/web/global/add-passkey-prompt "Later chosen recently"
		const storage = memoryStorage({
			[StorageKeys.passkeyPromptLater]: String(Date.now() - 10 * DAY_MS),
		})
		const { shown } = await logInOn(storage)
		expect(shown()).toBeNull()
	})

	it('shows again after "Later" chosen 31 days ago', async () => {
		// @spec components/infrastructure/fan/web/global/add-passkey-prompt "Later chosen long ago"
		const storage = memoryStorage({
			[StorageKeys.passkeyPromptLater]: String(Date.now() - 31 * DAY_MS),
		})
		const { shown } = await logInOn(storage)
		expect(shown()).not.toBeNull()
	})

	it('creates the passkey in the hosted login and returns to the screen the fan was on', async () => {
		// @spec components/infrastructure/fan/web/global/add-passkey-prompt "Create on this device"
		window.history.replaceState(null, '', '/tickets?tab=upcoming')
		const storage = memoryStorage()
		const first = await logInOn(storage)
		await first.click('add-passkey-create')

		expect(first.location.assign).toHaveBeenCalledWith(
			'https://auth.test.local/ui/v2/login/passkey/set?loginName=fan%40example.com&organization=test-org-id',
		)
		expect(first.shown()).toBeNull()

		// Back at the app root after creating it: the fan returns to the screen
		// they were on, and the device is recorded.
		const back = first.fixture.container.get(IAddPasskeyPromptService)
		expect(back.takeReturnAfterCreate()).toBe('/tickets?tab=upcoming')
		expect(storage.getItem(StorageKeys.passkeyDeviceRecord)).toBe('1')

		// Later Log Ins on the device show no prompt.
		const later = await logInOn(storage)
		expect(later.shown()).toBeNull()
		window.history.replaceState(null, '', '/')
	})

	it('closes on "This device already has one" and never shows on the device again', async () => {
		// @spec components/infrastructure/fan/web/global/add-passkey-prompt "Already has one"
		const storage = memoryStorage()
		const first = await logInOn(storage)
		await first.click('add-passkey-already')
		expect(first.shown()).toBeNull()
		expect(first.location.assign).not.toHaveBeenCalled()

		const next = await logInOn(storage)
		expect(next.shown()).toBeNull()
	})

	it('treats a dismissal as "Later": hidden on the device for 30 days', async () => {
		// @spec components/infrastructure/fan/web/global/add-passkey-prompt "Dismissed"
		const storage = memoryStorage()
		const first = await logInOn(storage)
		first.fixture.appHost
			.querySelector('bottom-sheet')
			?.dispatchEvent(new CustomEvent('sheet-closed', { bubbles: true }))
		await tasksSettled()
		expect(first.shown()).toBeNull()

		const next = await logInOn(storage)
		expect(next.shown()).toBeNull()

		// After 30 days it may show again.
		vi.useFakeTimers({ toFake: ['Date'] })
		vi.setSystemTime(Date.now() + ADD_PASSKEY_LATER_MS + 1)
		const after = await logInOn(storage)
		expect(after.shown()).not.toBeNull()
	})

	it('takes the prompt slot, so no other prompt opens while it is shown', async () => {
		const { fixture } = await logInOn(memoryStorage())
		expect(
			fixture.container.get(IPromptCoordinator).canShowPrompt('notification'),
		).toBe(false)
	})
})
