/**
 * Published on the sign-out path, before the OIDC sign-out redirect, so every
 * store can self-clear while the app is still alive. Also published on an
 * account switch (a sign-in callback for an account other than the one stored
 * on this device), before the new account's state loads.
 *
 * Each store subscribes and clears its own state independently — clearing is
 * idempotent and order-independent, so there is no orchestrator and no
 * completion barrier. Stores that cache user-specific data (e.g. the follow
 * store's followed-artist projections) MUST also evict that cache here so a
 * subsequent visitor on a shared browser never sees the previous user's data.
 *
 * Replaces the old guest-service `clearAll()` sign-out responsibility, now
 * split across the stores that own each guest slice (UserStore: home/language;
 * FollowStore: follow queue + projection cache).
 */
export class SignedOut {}
