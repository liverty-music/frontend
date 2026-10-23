import ja from '../../src/locales/ja/translation.json'

type Catalog = Record<string, unknown>

/**
 * A minimal I18N whose `tr` reads the real catalog with i18next-style
 * `{{name}}` interpolation, for unit tests that assert the words a fan sees
 * without starting Aurelia's i18n plugin.
 */
export function createCatalogI18n(catalog: Catalog = ja, locale = 'ja') {
	return {
		tr(key: string, options?: Record<string, unknown>): string {
			let value: unknown = catalog
			for (const part of key.split('.')) {
				value = (value as Catalog | undefined)?.[part]
			}
			if (typeof value !== 'string') return key
			return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
				String(options?.[name] ?? ''),
			)
		},
		getLocale: () => locale,
	}
}
