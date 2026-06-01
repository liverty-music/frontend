/**
 * Published on the sign-out path, before the OIDC sign-out redirect, so every
 * store can self-clear while the app is still alive.
 *
 * Each store subscribes and clears its own state independently — clearing is
 * idempotent and order-independent, so there is no orchestrator and no
 * completion barrier. Stores that cache user-specific data (e.g. the follow
 * store's followed-artist projections) MUST also evict that cache here so a
 * subsequent visitor on a shared browser never sees the previous user's data.
 *
 * Replaces the old `GuestService.clearAll()` sign-out responsibility.
 */
export class SignedOut {}
