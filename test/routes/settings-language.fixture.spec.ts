import { I18N, I18nConfiguration } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { Code, ConnectError } from '@connectrpc/connect'
import { CustomElement, IEventAggregator, Registration } from 'aurelia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Snack } from '../../shared/ui/snack-bar/snack'
import { IUserRpcClient } from '../../src/adapter/rpc/client/user-client'
import { IAppConfig } from '../../src/config/app-config'
import { StorageKeys } from '../../src/constants/storage-keys'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import { IConsentService } from '../../src/lib/consent/consent-service'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { SettingsRoute } from '../../src/routes/settings/settings-route'
import { IAudioEngine } from '../../src/services/audio-engine'
import { IAuthService } from '../../src/services/auth-service'
import { IFabMenuService } from '../../src/services/fab-menu-service'
import { IIdentityVerificationService } from '../../src/services/identity-verification-service'
import { IPushService } from '../../src/services/push-service'
import { IUserStore, UserStore } from '../../src/services/user-store'

// The shared language-change utility, spied but kept real, so a test can tell
// Settings delegates to it.
vi.mock('../../src/util/change-locale', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('../../src/util/change-locale')>()
	return { ...actual, changeLocale: vi.fn(actual.changeLocale) }
})
const { changeLocale } = await import('../../src/util/change-locale')

/** The home selector is not under test here; the bottom sheet passes through. */
const UserHomeSelectorStub = CustomElement.define(
	{
		name: 'user-home-selector',
		template: '',
		bindables: ['currentCode', 'onHomeSelected'],
	},
	class {
		public open(): void {}
	},
)
const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<au-slot></au-slot>',
		bindables: ['open', 'ariaLabel'],
	},
	class {},
)

interface Options {
	readonly authenticated: boolean
	readonly lng?: 'ja' | 'en'
	/** The signed-in fan's saved language; absent for a NULL legacy row. */
	readonly preferredLanguage?: string
	readonly setPreferredLanguage?: (lang: string) => Promise<unknown>
}

/**
 * Renders the real Settings template with the real i18n, translation bundles
 * and UserStore. Only the RPC client and the services the language row does
 * not use are doubles.
 */
async function render(o: Options) {
	const rpc = {
		setPreferredLanguage: vi.fn(
			o.setPreferredLanguage ??
				(async (lang: string) => ({ id: 'user-1', preferredLanguage: lang })),
		),
	}
	const auth = {
		isAuthenticated: o.authenticated,
		user: o.authenticated
			? { profile: { email: 'fan@example.com', email_verified: true } }
			: null,
	}
	const fixture = await createFixture
		.html('<settings-route component.ref="vm"></settings-route>')
		.deps(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng: o.lng ?? 'ja',
					fallbackLng: 'ja',
					resources: { ja: { translation: ja }, en: { translation: en } },
				}
			}),
			Registration.instance(IAuthService, auth),
			Registration.instance(IUserRpcClient, rpc),
			Registration.singleton(IUserStore, UserStore),
			Registration.instance(IPushService, {
				resolvePushState: vi.fn(async () => 'needs-permission'),
			}),
			Registration.instance(IIdentityVerificationService, {
				current: undefined,
			}),
			Registration.instance(IRouter, { load: vi.fn() }),
			Registration.instance(IAudioEngine, { muted: false, volume: 0.5 }),
			Registration.instance(IAppConfig, { vapidPublicKey: '' }),
			Registration.instance(IConsentService, {
				analytics: true,
				sessionReplay: true,
			}),
			Registration.instance(IFabMenuService, { isLeftHanded: false }),
			BusyOnClickCustomAttribute,
			UserHomeSelectorStub,
			BottomSheetStub,
			SettingsRoute,
		)
		.build().started
	const container = fixture.container
	const userStore = container.get(IUserStore)
	if (o.authenticated) {
		userStore.current = {
			id: 'user-1',
			...(o.preferredLanguage
				? { preferredLanguage: o.preferredLanguage }
				: {}),
		} as never
	}
	await tasksSettled()

	const host = fixture.appHost
	const vm = (fixture.component as unknown as { vm: SettingsRoute }).vm
	const snacks: Snack[] = []
	container.get(IEventAggregator).subscribe(Snack, (s: Snack) => {
		snacks.push(s)
	})
	const rowValue = (labelKey: string) => {
		const label = [...host.querySelectorAll('.settings-row-label')].find(
			(l) => l.textContent === labelKey,
		)
		return label?.closest('button')?.querySelector('.settings-row-value')
			?.textContent
	}
	const languageRow = () =>
		rowValue(container.get(I18N).tr('settings.language'))
	const options = () =>
		[...host.querySelectorAll<HTMLButtonElement>('.language-option')].map(
			(b) => ({
				el: b,
				label: b.textContent?.trim() ?? '',
				checked: b.getAttribute('aria-checked') === 'true',
			}),
		)
	const choose = async (label: string) => {
		options()
			.find((x) => x.label === label)
			?.el.click()
		await new Promise((r) => setTimeout(r, 0))
		await tasksSettled()
	}
	return {
		fixture,
		host,
		vm,
		rpc,
		userStore,
		i18n: container.get(I18N),
		snacks,
		rowValue,
		languageRow,
		options,
		choose,
	}
}

describe('Settings language and home area (fixture)', () => {
	afterEach(() => {
		localStorage.clear()
		vi.restoreAllMocks()
	})

	// @spec components/infrastructure/fan/web/route/settings "Displaying language option"
	it("shows the signed-in fan's saved language, not a stored one", async () => {
		const getItem = vi.spyOn(Storage.prototype, 'getItem')
		const r = await render({
			authenticated: true,
			lng: 'ja',
			preferredLanguage: 'en',
		})

		// Derived from User.preferredLanguage ('en'), though the UI is in ja.
		expect(r.languageRow()).toBe('English')
		expect(getItem).not.toHaveBeenCalledWith(StorageKeys.language)
		await r.fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/route/settings "Displaying language option before backfill completes"
	it('shows the active locale until the saved language arrives, then follows it', async () => {
		const getItem = vi.spyOn(Storage.prototype, 'getItem')
		const r = await render({ authenticated: true, lng: 'en' })

		// No saved language yet (NULL row): the active locale is shown.
		expect(r.languageRow()).toBe('English')
		expect(getItem).not.toHaveBeenCalledWith(StorageKeys.language)

		// The backfill response populates the User; the row re-evaluates.
		r.userStore.current = { id: 'user-1', preferredLanguage: 'ja' } as never
		await tasksSettled()
		expect(r.languageRow()).toBe('日本語')
		await r.fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/route/settings "Changing language"
	it('offers 日本語 and English and saves a new choice before switching the UI', async () => {
		const setItem = vi.spyOn(Storage.prototype, 'setItem')
		const r = await render({
			authenticated: true,
			lng: 'ja',
			preferredLanguage: 'ja',
		})
		vi.mocked(changeLocale).mockClear()

		r.vm.openLanguageSelector()
		await tasksSettled()
		expect(r.options().map((x) => x.label)).toEqual(['日本語', 'English'])

		await r.choose('English')

		expect(r.rpc.setPreferredLanguage).toHaveBeenCalledExactlyOnceWith('en')
		expect(r.i18n.getLocale()).toBe('en')
		// The page text follows the new locale, the row included.
		expect(r.languageRow()).toBe('English')
		expect(r.host.querySelector('.settings-section-title')?.textContent).toBe(
			en.settings.preferences,
		)
		expect(r.userStore.currentLanguage).toBe('en')
		// Saved on this device too, so the Welcome page after a sign-out opens
		// in it (i18n "Language switched while signed in survives sign-out").
		expect(setItem).toHaveBeenCalledWith(StorageKeys.language, 'en')
		expect(r.vm.languageSelectorOpen).toBe(false)
		await r.fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/route/settings "Language change RPC failure"
	// @spec components/infrastructure/fan/web/global/i18n "Authenticated language switch RPC failure"
	it('keeps the language and says so with a Snack when the save fails', async () => {
		const r = await render({
			authenticated: true,
			lng: 'ja',
			preferredLanguage: 'ja',
			setPreferredLanguage: async () => {
				throw new ConnectError('unavailable', Code.Unavailable)
			},
		})

		r.vm.openLanguageSelector()
		await tasksSettled()
		await r.choose('English')

		expect(r.rpc.setPreferredLanguage).toHaveBeenCalledOnce()
		expect(r.i18n.getLocale()).toBe('ja')
		expect(r.languageRow()).toBe('日本語')
		expect(r.snacks).toHaveLength(1)
		expect(r.snacks[0].message).toBe(ja.settings.languageChangeError)
		await r.fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/route/settings "Re-selecting the current language is a no-op"
	it('closes the selector without an RPC when the current language is chosen', async () => {
		const r = await render({
			authenticated: true,
			lng: 'ja',
			preferredLanguage: 'ja',
		})

		r.vm.openLanguageSelector()
		await tasksSettled()
		await r.choose('日本語')

		expect(r.vm.languageSelectorOpen).toBe(false)
		expect(r.rpc.setPreferredLanguage).not.toHaveBeenCalled()
		expect(r.i18n.getLocale()).toBe('ja')
		await r.fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/route/settings "Guest changes language"
	// @spec components/infrastructure/fan/web/global/i18n "Used by both Welcome and Settings"
	it("switches a guest's UI through the shared utility, without an RPC", async () => {
		const r = await render({ authenticated: false, lng: 'ja' })
		vi.mocked(changeLocale).mockClear()

		r.vm.openLanguageSelector()
		await tasksSettled()
		await r.choose('English')

		// The same utility Welcome calls; for a guest it never reaches the server.
		expect(changeLocale).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ userStore: r.userStore }),
			'en',
		)
		expect(r.i18n.getLocale()).toBe('en')
		expect(r.host.querySelector('.settings-section-title')?.textContent).toBe(
			en.settings.preferences,
		)
		expect(r.rpc.setPreferredLanguage).not.toHaveBeenCalled()
		await r.fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/route/settings "Selector highlight follows the active locale for guests"
	it("highlights the guest's newly active language when the selector reopens", async () => {
		const r = await render({ authenticated: false, lng: 'en' })
		r.vm.openLanguageSelector()
		await tasksSettled()
		expect(
			r
				.options()
				.filter((x) => x.checked)
				.map((x) => x.label),
		).toEqual(['English'])

		await r.choose('日本語')
		r.vm.openLanguageSelector()
		await tasksSettled()

		expect(
			r
				.options()
				.filter((x) => x.checked)
				.map((x) => x.label),
		).toEqual(['日本語'])
		expect(r.languageRow()).toBe('日本語')
		await r.fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/route/settings "Guest home area sourced from the user store"
	it("reads and writes a guest's home area through the user store", async () => {
		localStorage.setItem('guest.home', 'JP-13')
		const r = await render({ authenticated: false, lng: 'ja' })
		const homeRow = () => r.rowValue(ja.settings.myHomeArea)

		expect(homeRow()).toBe(ja.userHome.prefectures.tokyo)

		await r.vm.onHomeSelected('JP-27')
		await tasksSettled()

		expect(r.userStore.currentHome).toBe('JP-27')
		expect(localStorage.getItem('guest.home')).toBe('JP-27')
		expect(homeRow()).toBe(ja.userHome.prefectures.osaka)
		await r.fixture.stop(true)
	})
})
