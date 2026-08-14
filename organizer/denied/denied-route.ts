/**
 * Access-denied placeholder for the organizer console. Shown to an
 * authenticated account that lacks the `owner` role on the `organizer-console`
 * project (see {@link ../hooks/auth-hook}). It carries `data: { role: false }`
 * in the route table so the guard admits it without re-running the role check.
 */
export class DeniedRoute {}
