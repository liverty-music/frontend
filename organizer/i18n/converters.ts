import { I18N, Signals } from '@aurelia/i18n'
import { resolve, valueConverter } from 'aurelia'
import { toConsoleLocale } from './console-language'
import {
	type CivilDate,
	type ConsoleLocale,
	type EventWhen,
	formatCount,
	formatEventDate,
	formatEventDay,
	formatEventWhen,
	formatMomentAt,
	formatSaleWindow,
	formatYen,
	type MomentAt,
	type SaleWindow,
} from './format'

/**
 * Template formatters for times in their zones, yen and counts. Each re-evaluates when
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

/** `${event.when | eventWhen}` → `2月20日(土) 19:30 ロンドン時間（日本時間 2月21日(日) 04:30）`. */
@valueConverter('eventWhen')
export class EventWhenValueConverter extends LocaleConverter {
	public toView(value: EventWhen | undefined | null): string {
		return value ? formatEventWhen(value, this.locale) : ''
	}
}

/** `${event.date | eventDate}` → `2026年11月3日(火)`. */
@valueConverter('eventDate')
export class EventDateValueConverter extends LocaleConverter {
	public toView(value: CivilDate | undefined | null): string {
		return value ? formatEventDate(value, this.locale) : ''
	}
}

/** `${event.day | eventDay}` → `11月3日(火)`. */
@valueConverter('eventDay')
export class EventDayValueConverter extends LocaleConverter {
	public toView(value: CivilDate | undefined | null): string {
		return value ? formatEventDay(value, this.locale) : ''
	}
}

/** `${sale.window | saleWindow}` → `… 〜 … 日本時間`, in the sale's zone. */
@valueConverter('saleWindow')
export class SaleWindowValueConverter extends LocaleConverter {
	public toView(value: SaleWindow | undefined | null): string {
		return value ? formatSaleWindow(value, this.locale) : ''
	}
}

/** `${scanner.boundSince | momentAt}` → `11月3日(火) 14:10 日本時間`, a past moment in a zone. */
@valueConverter('momentAt')
export class MomentAtValueConverter extends LocaleConverter {
	public toView(value: MomentAt | undefined | null): string {
		return value ? formatMomentAt(value, this.locale) : ''
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
	EventWhenValueConverter,
	EventDateValueConverter,
	EventDayValueConverter,
	SaleWindowValueConverter,
	MomentAtValueConverter,
	YenValueConverter,
	CountValueConverter,
]
