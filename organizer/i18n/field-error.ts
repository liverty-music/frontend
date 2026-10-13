/** A field error: a catalog key and its values, translated where it is shown. */
export interface FieldError {
	key: string
	params?: Record<string, unknown>
}
