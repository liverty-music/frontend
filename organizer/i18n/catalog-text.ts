/**
 * Text from the console's catalog: a key and its values. A view-model hands
 * this to its template, which translates it (`${text.key & t:text.params}`),
 * so the text follows a language switch (design D17). A value may be a
 * calendar date or an Event's date and times, formatted in the zone it belongs
 * to by the catalog's `eventDay` / `eventWhen` formats (`{{day, eventDay}}`).
 */
export interface CatalogText {
	key: string
	params?: Record<string, unknown>
}
