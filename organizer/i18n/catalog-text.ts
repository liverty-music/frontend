/**
 * Text from the console's catalog: a key and its values. A view-model hands
 * this to its template, which translates it (`${text.key & t:text.params}`),
 * so the text follows a language switch (design D17). A value may be a Date,
 * formatted in Japan time by the catalog's `jstDay` / `jstDateTime` formats
 * (`{{day, jstDay}}`).
 */
export interface CatalogText {
	key: string
	params?: Record<string, unknown>
}
