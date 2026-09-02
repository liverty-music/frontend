/**
 * Shared JPY money formatter. Renders whole-yen amounts with the yen symbol and
 * thousands separators (e.g. 12000 → "¥12,000"). JPY has no minor unit, so no
 * fraction digits are shown. Used for the lottery 特商法 total (a legally
 * sensitive amount) and the organizer status/price displays so money renders
 * consistently across the app.
 */
const jpyFormatter = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

/** Formats a whole-yen amount as "¥12,000". Accepts number or bigint. */
export function formatJpy(amountYen: number | bigint): string {
	return jpyFormatter.format(amountYen)
}
