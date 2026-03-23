import type { I18N } from '@aurelia/i18n'

export const SUPPORTED_LANGUAGES = ['ja', 'en'] as const

export async function changeLocale(i18n: I18N, lang: string): Promise<void> {
	await i18n.setLocale(lang)
	localStorage.setItem('language', lang)
}
