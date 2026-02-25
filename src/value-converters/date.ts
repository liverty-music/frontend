import { valueConverter } from 'aurelia'

@valueConverter('date')
export class DateValueConverter {
	toView(
		value: string | Date | undefined | null,
		format: 'short' | 'long' | 'relative' = 'short',
	): string {
		if (!value) return ''

		const date = value instanceof Date ? value : new Date(value)
		if (Number.isNaN(date.getTime())) return ''

		if (format === 'relative') {
			return this.toRelative(date)
		}

		const options: Intl.DateTimeFormatOptions =
			format === 'long'
				? { year: 'numeric', month: 'long', day: 'numeric' }
				: { month: 'numeric', day: 'numeric' }

		return new Intl.DateTimeFormat('ja-JP', options).format(date)
	}

	private toRelative(date: Date): string {
		const now = new Date()
		const diffMs = date.getTime() - now.getTime()
		const absDiffMs = Math.abs(diffMs)

		const minutes = Math.floor(absDiffMs / 60_000)
		const hours = Math.floor(absDiffMs / 3_600_000)
		const days = Math.floor(absDiffMs / 86_400_000)

		const rtf = new Intl.RelativeTimeFormat('ja-JP', { numeric: 'auto' })
		const sign = diffMs >= 0 ? 1 : -1

		if (days > 0) return rtf.format(sign * days, 'day')
		if (hours > 0) return rtf.format(sign * hours, 'hour')
		if (minutes > 0) return rtf.format(sign * minutes, 'minute')
		return rtf.format(0, 'second')
	}
}
