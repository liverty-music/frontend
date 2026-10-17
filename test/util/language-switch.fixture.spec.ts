import { I18N, I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { Registration } from 'aurelia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IUserRpcClient } from '../../src/adapter/rpc/client/user-client'
import { StorageKeys } from '../../src/constants/storage-keys'
import type { User } from '../../src/entities/user'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { IAuthService } from '../../src/services/auth-service'
import { IUserStore, UserStore } from '../../src/services/user-store'
import { changeLocale } from '../../src/util/change-locale'
import { DateValueConverter } from '../../src/value-converters/date'

/**
 * Switching the language mid-session through the shared changeLocale utility,
 * with the real i18n, the real UserStore and real translation bundles: the
 * rendered `t` strings, the persistence and the date formatting.
 */
async function render(opts: { authenticated: boolean }) {
	const rpc = {
		setPreferredLanguage: vi.fn(async (lang: string) => ({
			id: 'user-1',
			preferredLanguage: lang,
		})),
	}
	const auth = { isAuthenticated: opts.authenticated }
	const fixture = await createFixture(
		'<span data-testid="label" t="settings.language"></span>',
		class App {},
		[
			I18nConfiguration.customize((o) => {
				o.initOptions = {
					lng: 'ja',
					fallbackLng: 'ja',
					resources: { ja: { translation: ja }, en: { translation: en } },
				}
			}),
			Registration.instance(IAuthService, auth),
			Registration.instance(IUserRpcClient, rpc),
			Registration.singleton(IUserStore, UserStore),
			DateValueConverter,
		],
	).started
	const container = fixture.container
	const i18n = container.get(I18N)
	const userStore = container.get(IUserStore)
	if (opts.authenticated) {
		userStore.current = { id: 'user-1', preferredLanguage: 'ja' } as User
	}
	const label = () =>
		fixture.appHost.querySelector('[data-testid="label"]')?.textContent
	const longDate = () =>
		container.get(DateValueConverter).toView(new Date(2026, 10, 20), 'long')
	return { fixture, rpc, i18n, userStore, label, longDate }
}

describe('changing the language mid-session (fixture)', () => {
	afterEach(() => {
		localStorage.clear()
	})

	// @spec components/infrastructure/fan/web/global/i18n "Switching language mid-session as an anonymous user"
	it('re-renders, persists the language key and formats dates in the new locale for a guest', async () => {
		const { fixture, rpc, i18n, userStore, label, longDate } = await render({
			authenticated: false,
		})
		expect(label()).toBe('言語')
		expect(longDate()).toContain('11月')

		await changeLocale(
			{ i18n, auth: { isAuthenticated: false }, userStore },
			'en',
		)
		await tasksSettled()

		expect(label()).toBe('Language')
		expect(localStorage.getItem(StorageKeys.language)).toBe('en')
		expect(rpc.setPreferredLanguage).not.toHaveBeenCalled()
		expect(longDate()).toContain('November')
		await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/global/i18n "Switching language mid-session as an authenticated user"
	it('saves the language with SetPreferredLanguage, then re-renders, for a signed-in fan', async () => {
		const { fixture, rpc, i18n, userStore, label, longDate } = await render({
			authenticated: true,
		})
		const getItem = vi.spyOn(Storage.prototype, 'getItem')
		const setItem = vi.spyOn(Storage.prototype, 'setItem')

		await changeLocale(
			{ i18n, auth: { isAuthenticated: true }, userStore },
			'en',
		)
		await tasksSettled()

		expect(rpc.setPreferredLanguage).toHaveBeenCalledExactlyOnceWith('en')
		expect(i18n.getLocale()).toBe('en')
		expect(label()).toBe('Language')
		expect(userStore.currentLanguage).toBe('en')
		expect(getItem).not.toHaveBeenCalledWith(StorageKeys.language)
		// The applied language is also saved on this device, so it survives a
		// sign-out.
		expect(setItem).toHaveBeenCalledWith(StorageKeys.language, 'en')
		expect(longDate()).toContain('November')
		await fixture.stop(true)
	})
})
