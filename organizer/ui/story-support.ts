import '../styles/main.css'
import { I18nConfiguration } from '@aurelia/i18n'
import { ConsoleFormatters } from '../i18n/converters'
import en from '../locales/en/translation.json'
import ja from '../locales/ja/translation.json'
import { ConsoleUi } from './index'

/**
 * Story parameters for console components: the console stylesheet (its own
 * tokens over the fan ones the preview loads), the console catalogs in
 * Japanese, the formatters and every console component.
 *
 * Imported by `organizer/**\/*.stories.ts` only; no app entry imports it.
 */
export const consoleStoryParameters = {
	aurelia: {
		register: [...ConsoleFormatters, ...ConsoleUi],
		configure: (au: { register: (...items: unknown[]) => unknown }) => {
			au.register(
				I18nConfiguration.customize((options) => {
					options.initOptions = {
						lng: 'ja',
						fallbackLng: 'ja',
						resources: {
							ja: { translation: ja },
							en: { translation: en },
						},
						interpolation: { escapeValue: false },
					}
				}),
			)
		},
	},
}
