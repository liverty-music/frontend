import { I18N } from '@aurelia/i18n'
import { bindable, optional, resolve } from 'aurelia'

export type CircularProgressSize = 'medium' | 'small'

/** Accessible names used when the app registers no i18n. */
const FALLBACK_LABELS: Readonly<Record<string, string>> = {
	ja: '読み込み中',
	en: 'Loading',
}

/**
 * Material 3 indeterminate circular progress indicator, shared by the fan app
 * and the organizer console. `size="small"` (24 px) is for use inside a
 * button; the default is 48 px. The arc takes the app's `primary` role, or the
 * content color inside a button; a parent can set `color` to override it.
 */
export class CircularProgress {
	private readonly i18n = resolve(optional(I18N))

	@bindable public size: CircularProgressSize = 'medium'

	/** Accessible name. Defaults to the localized word for loading. */
	@bindable public label = ''

	public get accessibleName(): string {
		if (this.label) return this.label
		const translated = this.i18n?.tr('common.loading')
		if (translated && translated !== 'common.loading') return translated
		const lang = document.documentElement.lang.split('-')[0]
		return FALLBACK_LABELS[lang] ?? FALLBACK_LABELS.ja
	}
}
