/**
 * Returns the URL unchanged only when it is an `http:`/`https:` URL; otherwise
 * returns an empty string.
 *
 * Aurelia HTML-escapes text interpolation but does NOT sanitize attribute
 * bindings, so any externally-sourced URL bound to an anchor `href` must pass
 * through this allowlist first. Without it a value like `javascript:<payload>`
 * — which can reach us via AI-discovered / user-imported data — would execute
 * script in the user's session when the link is clicked.
 */
export function sanitizeUrl(url: string | undefined): string {
	if (!url) return ''
	try {
		const parsed = new URL(url)
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			return url
		}
	} catch {
		// Invalid URL — fall through to empty.
	}
	return ''
}
