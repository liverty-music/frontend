import { I18N, I18nConfiguration, Signals } from '@aurelia/i18n'
import { AppTask, IContainer, IEventAggregator, type IRegistry } from 'aurelia'
import i18nextBrowserLanguageDetector from 'i18next-browser-languagedetector'
import { StorageKeys } from '../../constants/storage-keys'
import en from '../../locales/en/translation.json'
import ja from '../../locales/ja/translation.json'
import { currentLanguage, SUPPORTED_LANGUAGES } from '../../util/change-locale'

/**
 * Keeps `<html lang>` equal to the language shown, so screen readers, the
 * browser's translation offer and hyphenation follow it. One subscriber to
 * the locale-changed signal covers every path that changes the language: the
 * detected language on first open, a guest switch, the account's language
 * applied after sign-in, and a signed-in switch from Settings.
 *
 * `index.html` keeps its static `lang="ja"` as the pre-boot value.
 */
async function syncDocumentLanguage(container: IContainer): Promise<void> {
	const i18n = container.get(I18N)
	const ea = container.get(IEventAggregator)
	const apply = () => {
		document.documentElement.lang = currentLanguage(i18n)
	}
	// Subscribe before awaiting init so a switch that lands meanwhile (e.g.
	// the hydration task applying the account's language) is not missed.
	ea.subscribe(Signals.I18N_EA_CHANNEL, apply)
	await i18n.initPromise
	apply()
}

/**
 * The fan app's i18n: Japanese and English catalogs, the language chosen on
 * first open (`?lang=` > saved on this device > the browser's language when
 * supported > English), and `<html lang>` kept equal to the language shown.
 */
export const FanI18nConfiguration: IRegistry = {
	register(container: IContainer): IContainer {
		return container.register(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					// Load-bearing: `@aurelia/i18n` injects a default `lng: 'en'` into the
					// i18next init options, and i18next treats an explicit `lng` as an
					// override that BYPASSES the language detector entirely. Setting it
					// back to `undefined` re-enables the `detection` chain below, so the
					// boot locale is resolved from querystring → localStorage → navigator
					// (honoring the migrated `language` key) instead of being hard-pinned
					// to English. Do NOT delete this as a no-op — its absence silently
					// disables detection and the app always boots English.
					lng: undefined,
					resources: {
						ja: { translation: ja },
						en: { translation: en },
					},
					// English, like the hosted login's default language: a browser in a
					// language the app does not offer sees one language end to end.
					fallbackLng: 'en',
					supportedLngs: [...SUPPORTED_LANGUAGES],
					interpolation: { escapeValue: false },
					detection: {
						order: ['querystring', 'localStorage', 'navigator'],
						lookupQuerystring: 'lang',
						lookupLocalStorage: StorageKeys.language,
						// Persist the detected locale to localStorage so anonymous reloads
						// see a stable language without re-detecting from navigator each
						// time. The key is kept in every auth state: while signed in the
						// account's language wins and is written back here, so the first
						// screen after a sign-out opens in it (see UserHydrationTask).
						caches: ['localStorage'],
					},
					plugins: [i18nextBrowserLanguageDetector],
				}
			}),
			AppTask.activating(IContainer, syncDocumentLanguage),
		)
	},
}
