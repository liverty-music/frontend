import { I18N } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageKeys } from '../../../src/constants/storage-keys'
import { FanI18nConfiguration } from '../../../src/lib/i18n/fan-i18n-configuration'

function browserLanguages(languages: string[]): void {
	vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
	vi.spyOn(navigator, 'language', 'get').mockReturnValue(languages[0])
}

async function mount() {
	const fixture = createFixture(
		`<p>\${'settings.language' & t}</p>`,
		class App {},
		[FanI18nConfiguration],
	)
	await fixture.startPromise
	await tasksSettled()
	return fixture
}

describe('fan i18n configuration', () => {
	beforeEach(() => {
		localStorage.clear()
		document.documentElement.lang = ''
	})
	afterEach(() => {
		localStorage.clear()
		vi.restoreAllMocks()
	})

	// @spec components/infrastructure/fan/web/global/i18n "English shown on first open"
	// @spec components/infrastructure/fan/web/global/i18n "Browser language detection is saved"
	it('opens in English on an English browser, saves it and declares it', async () => {
		browserLanguages(['en-US', 'en'])
		const { assertText, container, tearDown } = await mount()
		const i18n = container.get(I18N)

		assertText('Language')
		expect(i18n.getLocale()).toBe('en')
		expect(localStorage.getItem(StorageKeys.language)).toBe('en')
		expect(document.documentElement.lang).toBe('en')
		await tearDown()
	})

	// @spec components/infrastructure/fan/web/global/i18n "Fallback to English"
	it('falls back to English on a browser in an unsupported language', async () => {
		browserLanguages(['fr-FR', 'fr'])
		const { assertText, tearDown } = await mount()

		assertText('Language')
		expect(localStorage.getItem(StorageKeys.language)).toBe('en')
		expect(document.documentElement.lang).toBe('en')
		await tearDown()
	})

	// @spec components/infrastructure/fan/web/global/i18n "Saved language (tentative initial locale)"
	it('opens in the language saved on this device over the browser language', async () => {
		// The boot after a sign-out: the saved account language wins over an
		// English browser.
		browserLanguages(['en-US', 'en'])
		localStorage.setItem(StorageKeys.language, 'ja')
		const { assertText, tearDown } = await mount()

		assertText('言語')
		expect(document.documentElement.lang).toBe('ja')
		await tearDown()
	})

	// @spec components/infrastructure/fan/web/global/i18n "URL parameter override"
	it('opens in the ?lang= language over the saved and browser language, and saves it', async () => {
		browserLanguages(['ja-JP', 'ja'])
		localStorage.setItem(StorageKeys.language, 'ja')
		window.history.replaceState(null, '', '/?lang=en')
		try {
			const { assertText, tearDown } = await mount()

			assertText('Language')
			expect(localStorage.getItem(StorageKeys.language)).toBe('en')
			expect(document.documentElement.lang).toBe('en')
			await tearDown()
		} finally {
			window.history.replaceState(null, '', '/')
		}
	})

	// @spec components/infrastructure/fan/web/global/i18n "Switch updates the declared language"
	// @spec components/infrastructure/fan/web/global/i18n "Account language applied after sign-in"
	it('declares the new language on every switch, without a reload', async () => {
		// Hydration applying the account's `ja` over a saved `en` goes through
		// the same setLocale as a guest switch.
		browserLanguages(['en-US', 'en'])
		localStorage.setItem(StorageKeys.language, 'en')
		const { assertText, container, tearDown } = await mount()
		const i18n = container.get(I18N)
		expect(document.documentElement.lang).toBe('en')

		await i18n.setLocale('ja')
		await tasksSettled()

		assertText('言語')
		expect(document.documentElement.lang).toBe('ja')
		await tearDown()
	})
})
