import { I18N, Signals } from '@aurelia/i18n'
import { resolve, valueConverter } from 'aurelia'
import { toConsoleLocale } from './console-language'
import {
	type ConsoleLocale,
	formatCount,
	formatJstDate,
	formatJstDateTime,
	formatJstDay,
	formatJstRange,
	formatJstTime,
	formatYen,
} from './format'

/**
 * Template formatters for Japan time, yen and counts. Each re-evaluates when
 * the language changes (the i18n signal), so a switch updates every value on
 * the page at once.
 */
abstract class LocaleConverter {
	public readonly signals = [Signals.I18N_SIGNAL]
	protected readonly i18n = resolve(I18N)

	protected get locale(): ConsoleLocale {
		return toConsoleLocale(this.i18n.getLocale())
	}
}

/** `${event.startsAt | jstDateTime}` → `11月3日(火) 18:00 JST`. */
@valueConverter('jstDateTime')
export class JstDateTimeValueConverter extends LocaleConverter {
	public toView(value: Date | undefined | null): string {
		return value ? formatJstDateTime(value, this.locale) : ''
	}
}

/** `${event.date | jstDate}` → `2026年11月3日(火)`. */
@valueConverter('jstDate')
export class JstDateValueConverter extends LocaleConverter {
	public toView(value: Date | undefined | null): string {
		return value ? formatJstDate(value, this.locale) : ''
	}
}

/** `${event.day | jstDay}` → `11月3日(火)`. */
@valueConverter('jstDay')
export class JstDayValueConverter extends LocaleConverter {
	public toView(value: Date | undefined | null): string {
		return value ? formatJstDay(value, this.locale) : ''
	}
}

/** `${sale | jstRange}` (an object with `start` and `end`) → `… 〜 … JST`. */
@valueConverter('jstRange')
export class JstRangeValueConverter extends LocaleConverter {
	public toView(
		value: { start?: Date; end?: Date } | undefined | null,
	): string {
		return value?.start
			? formatJstRange(value.start, value.end, this.locale)
			: ''
	}
}

/** `${event.startsAt | jstTime}` → `18:00 JST`. */
@valueConverter('jstTime')
export class JstTimeValueConverter extends LocaleConverter {
	public toView(value: Date | undefined | null): string {
		return value ? formatJstTime(value, this.locale) : ''
	}
}

/** `${ticketType.price | yen}` → `6,500円` / `¥6,500`. */
@valueConverter('yen')
export class YenValueConverter extends LocaleConverter {
	public toView(value: number | bigint | undefined | null): string {
		if (value === undefined || value === null) return ''
		return formatYen(value, this.locale, (amount) =>
			this.i18n.tr('format.yen', { amount }),
		)
	}
}

/** `${stats.entries | count}` → `1,380`. */
@valueConverter('count')
export class CountValueConverter extends LocaleConverter {
	public toView(value: number | bigint | undefined | null): string {
		if (value === undefined || value === null) return ''
		return formatCount(value, this.locale)
	}
}

export const ConsoleFormatters = [
	JstDateTimeValueConverter,
	JstDateValueConverter,
	JstDayValueConverter,
	JstRangeValueConverter,
	JstTimeValueConverter,
	YenValueConverter,
	CountValueConverter,
]
