/**
 * Requests migration of the guest follow queue into the authenticated account.
 *
 * Published by `AuthCallbackRoute` on EVERY successful authenticated callback
 * (sign-up AND sign-in) once the user has been provisioned and the internal
 * `userId` is available. The single ordering edge in the auth-boundary
 * transition is "provision before migrate" (migration needs a `userId`), which
 * the publisher guarantees.
 *
 * Fires on any authentication — not only sign-up — because a returning user who
 * browsed anonymously (accumulating guest follows) and then SIGNS IN via
 * Settings / auth-status (paths that do NOT clearAll) would otherwise lose those
 * follows in-session until a cold-boot reconcile healed them. `FollowStore`'s
 * `migrateGuestFollows` is receipt-guarded, idempotent, and a no-op on an empty
 * queue, so publishing unconditionally on a successful callback is safe: an
 * empty-queue callback does nothing and already-migrated state is not
 * re-migrated (the per-account receipt makes the queue-level migration
 * exactly-once).
 *
 * NOT published from `UserService.create()`: that method is also reached on the
 * idempotent cache-miss recovery, so owning the publish in the callback keeps
 * the trigger at the single auth-boundary site with the resolved `userId`.
 *
 * Subscribers run best-effort and are NOT awaited by the publisher — follow
 * migration is background work; a partial failure is healed by boot
 * reconciliation rather than blocking navigation.
 */
export class GuestMigrationRequested {
	constructor(public readonly userId: string) {}
}
