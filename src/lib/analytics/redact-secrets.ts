/**
 * Replaces authentication material in free text with placeholders: Bearer
 * tokens, JWTs and the OIDC `code` / `state` / token query parameters. Shared
 * by the error report sent to the team and the report email, so neither
 * carries a credential (OpenSpec `global/error-banner`).
 */
export function redactSecrets(text: string): string {
	return text
		.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]')
		.replace(
			/eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/g,
			'[JWT_REDACTED]',
		)
		.replace(
			/[?&](code|state|id_token|access_token|refresh_token)=[^&\s)]*/g,
			(_, key) => `${key}=[REDACTED]`,
		)
}
