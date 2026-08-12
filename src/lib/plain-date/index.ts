/**
 * Plain-date library entry point — the single seam for the SPA's civil-date
 * arithmetic. Consumers import from here (`@/lib/plain-date`) and never from a
 * concrete engine module.
 *
 * `plain-date-engine` is a build-time alias (Vite `resolve.alias`, tsconfig
 * `paths`) that resolves to exactly one engine per build: `date-impl` by
 * default, `temporal-impl` when `VITE_DATE_ENGINE=temporal`. The unselected
 * engine is never in the module graph, so production ships one engine at
 * +0 KB. See OpenSpec `introduce-swappable-plain-date-lib`.
 */

export {
	addDays,
	formatDateInput,
	inclusiveDaySpan,
	isValidCalendarDate,
	parseDateInput,
	resolveWeekend,
	todayCalendarDate,
} from 'plain-date-engine'
export type { CalendarDate, CalendarDateEngine, DateRange } from './types'
