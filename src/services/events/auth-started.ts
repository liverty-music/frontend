/**
 * Re-export shim. `AuthStarted` physically lives in `shared/` because the
 * shared `AuthService` publishes it before the hosted-login redirect.
 */
export { AuthStarted } from '../../../shared/services/events/auth-started'
