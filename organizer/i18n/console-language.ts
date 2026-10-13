import { I18N, I18nConfiguration, Signals } from '@aurelia/i18n'
import {
	AppTask,
	DI,
	IContainer,
	IEventAggregator,
	type IRegistry,
	resolve,
} from 'aurelia'
import i18nextBrowserLanguageDetector from 'i18next-browser-languagedetector'
import en from '../locales/en/translation.json'
import ja from '../locales/ja/translation.json'
import { type ConsoleLocale, formatJstDateTime, formatJstDay } from './format'

/**
 * localStorage key of the language chosen on this device. The console origin
 * has its own storage, and operators have no User row to hold a preference,
 * so the choice is per device.
 */
export const LANGUAGE_STORAGE_KEY = 'organizer.language'

export const CONSOLE_LANGUAGES: readonly ConsoleLocale[] = ['ja', 'en']

/**
 * Saves the language for the next visit on this device. Best-effort: when
 * storage is unavailable the switch still applies to the open page.
 */
export function saveLanguage(language: ConsoleLocale): void {
	try {
		window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
	} catch {
		// Storage disabled: the choice lasts for this page only.
	}
}

/** The current language of the console and the switch the account menu uses. */
export class ConsoleLanguage {
	private readonly i18n = resolve(I18N)

	/**
	 * The language shown, as an observed property. A getter reading i18n
	 * would be cached by Aurelia's observation (i18next is not observed), so
	 * the account menu's mark kept the first language after a switch.
	 */
	public current: ConsoleLocale = 'ja'

	public constructor() {
		void this.i18n.initPromise.then(() => {
			this.current = toConsoleLocale(this.i18n.getLocale())
		})
	}

	/**
	 * A catalog text in the language being shown, for text that leaves the
	 * page: the title handed to the share sheet, a default name the operator
	 * saves. Text the page shows is translated in its template, so that it
	 * follows a language switch (design D17).
	 */
	public text(key: string, params?: Record<string, unknown>): string {
		return this.i18n.tr(key, params)
	}

	/** Changes every text on the page at once and saves the choice. */
	public async set(language: ConsoleLocale): Promise<void> {
		await this.i18n.setLocale(language)
		this.current = toConsoleLocale(this.i18n.getLocale())
		saveLanguage(language)
	}
}

export const IConsoleLanguage = DI.createInterface<IConsoleLanguage>(
	'IConsoleLanguage',
	(x) => x.singleton(ConsoleLanguage),
)
export interface IConsoleLanguage extends ConsoleLanguage {}

/** Maps an i18next language (`en-US`, `ja`) to a console language. */
export function toConsoleLocale(language: string | undefined): ConsoleLocale {
	return language?.toLowerCase().startsWith('en') ? 'en' : 'ja'
}

/** Keeps `<html lang>` equal to the language shown. */
async function syncDocumentLanguage(container: IContainer): Promise<void> {
	const i18n = container.get(I18N)
	const ea = container.get(IEventAggregator)
	const apply = () => {
		document.documentElement.lang = toConsoleLocale(i18n.getLocale())
	}
	await i18n.initPromise
	apply()
	ea.subscribe(Signals.I18N_EA_CHANNEL, apply)
}

/**
 * Catalog formats for Date values, in Japan time and the language being
 * shown: `{{day, jstDay}}` → `11月3日(火)`, `{{at, jstDateTime}}` →
 * `11月3日(火) 18:00 JST`. A view-model passes the Date itself, so a language
 * switch re-formats it with the text around it.
 */
async function addCatalogFormats(container: IContainer): Promise<void> {
	const i18n = container.get(I18N)
	await i18n.initPromise
	const formats: Record<string, (date: Date, locale: ConsoleLocale) => string> =
		{ jstDay: formatJstDay, jstDateTime: formatJstDateTime }
	for (const [name, format] of Object.entries(formats)) {
		i18n.i18next.services.formatter?.add(name, (value, lng) =>
			value instanceof Date
				? format(value, toConsoleLocale(lng))
				: String(value ?? ''),
		)
	}
}

/** The catalog formats, for an app that configures i18n itself (stories). */
export const ConsoleCatalogFormats = AppTask.activating(
	IContainer,
	addCatalogFormats,
)

/**
 * The console's i18n: Japanese and English catalogs; the language saved on
 * this device first, then the browser's language (English when it is English,
 * Japanese otherwise).
 */
export const ConsoleI18nConfiguration: IRegistry = {
	register(container: IContainer): IContainer {
		return container.register(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					// `@aurelia/i18n` injects `lng: 'en'`, and an explicit `lng` makes
					// i18next skip the detector. `undefined` re-enables detection.
					lng: undefined,
					resources: {
						ja: { translation: ja },
						en: { translation: en },
					},
					fallbackLng: 'ja',
					supportedLngs: [...CONSOLE_LANGUAGES],
					// `en-US` counts as `en`; an unsupported language falls back to ja.
					nonExplicitSupportedLngs: true,
					load: 'languageOnly',
					interpolation: { escapeValue: false },
					detection: {
						order: ['localStorage', 'navigator'],
						lookupLocalStorage: LANGUAGE_STORAGE_KEY,
						// Only an explicit switch saves a language (ConsoleLanguage.set).
						caches: [],
					},
					plugins: [i18nextBrowserLanguageDetector],
				}
			}),
			AppTask.activating(IContainer, syncDocumentLanguage),
			ConsoleCatalogFormats,
		)
	},
}
