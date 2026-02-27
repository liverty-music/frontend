import { I18N } from '@aurelia/i18n'
import { resolve, valueConverter } from 'aurelia'

@valueConverter('date')
export class DateValueConverter {
	private readonly i18n = resolve(I18N)

	toView(
		value: string | Date | undefined | null,
		format: 'short' | 'long' | 'relative' = 'short',
	): string {
		if (!value) return ''

		const date = value instanceof Date ? value : new Date(value)
		if (Number.isNaN(date.getTime())) return ''

		const locale = this.i18n.getLocale()

		if (format === 'relative') {
			return this.toRelative(date, locale)
		}

		const options: Intl.DateTimeFormatOptions =
			format === 'long'
				? { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }
				: { month: 'numeric', day: 'numeric' }

		return new Intl.DateTimeFormat(locale, options).format(date)
	}

	private toRelative(date: Date, locale: string): string {
		const now = new Date()
		const diffMs = date.getTime() - now.getTime()
		const absDiffMs = Math.abs(diffMs)

		const minutes = Math.floor(absDiffMs / 60_000)
		const hours = Math.floor(absDiffMs / 3_600_000)
		const days = Math.floor(absDiffMs / 86_400_000)

		const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
		const sign = diffMs >= 0 ? 1 : -1

		if (days > 0) return rtf.format(sign * days, 'day')
		if (hours > 0) return rtf.format(sign * hours, 'hour')
		if (minutes > 0) return rtf.format(sign * minutes, 'minute')
		return rtf.format(0, 'second')
	}
}
