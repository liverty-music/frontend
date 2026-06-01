import { I18N } from '@aurelia/i18n'
import { AppTask, IContainer, ILogger } from 'aurelia'
import { SessionKeys } from '../constants/storage-keys'
import { normalizeToSupportedLanguage } from '../util/change-locale'
import { IAuthService } from './auth-service'
import { IFollowStore } from './follow-store'
import { IUserStore } from './user-store'

/**
 * Boot reconciliation of leftover guest follows, keyed on the per-account
 * guest-merge receipt (NOT the mere presence of guest data) so reverted state
 * is never resurrected:
 *
 *   - authenticated + leftover queue + NO receipt → migrate (idempotent,
 *     per-item drain), write receipt, clear.
 *   - authenticated + residual queue + receipt ALREADY present → clear WITHOUT
 *     re-migrating (a prior clear failed; the user may have reverted state, so
 *     re-following would resurrect it).
 *
 * Runs early (activating AppTask) and session-guarded so the reconcile fires at
 * most once per tab. Mirrors the `user-hydration-task` boot pattern, and is
 * exported separately from its `AppTask` wrapper so tests can drive it with
 * stubbed services.
 */
export async function runFollowReconcile(container: IContainer): Promise<void> {
	// Eagerly resolve FollowStore FIRST so its constructor's GuestMigrationRequested /
	// SignedOut subscriptions are live before any sign-up or sign-out can fire
	// (a plain DI singleton is otherwise lazy and would miss early events).
	const followStore = container.get(IFollowStore)

	const auth = container.get(IAuthService)
	await auth.ready

	if (!auth.isAuthenticated) return

	// Session guard: one reconcile attempt per tab. Idempotent backend calls
	// make a missed attempt harmless (the next cold start retries).
	if (sessionStorage.getItem(SessionKeys.followReconcileAttempted)) return
	sessionStorage.setItem(SessionKeys.followReconcileAttempted, '1')

	const logger = container.get(ILogger).scopeTo('FollowReconcileTask')

	// Nothing left in the guest queue → nothing to reconcile. The queue is owned
	// by FollowStore (via its FollowServiceClient delegate) now that GuestService
	// is dissolved.
	if (followStore.guestFollows.length === 0) return

	const userStore = container.get(IUserStore)

	// Self-sufficient hydration: same-slot AppTasks (UserHydrationTask and this
	// task) run CONCURRENTLY via Promise.all (onResolveAll), NOT sequentially in
	// registration order — so we cannot assume `current` is populated by the
	// time we read it. ensureLoaded is idempotent (the same call hydration uses):
	// it returns the in-memory user if already loaded, otherwise resolves the
	// Get/idempotent-Create chain. Awaiting it here guarantees `current.id` is
	// available without racing UserHydrationTask. Pass the effective locale for
	// the cache-miss Create path, mirroring UserHydrationTask.
	const clientLocale = normalizeToSupportedLanguage(
		container.get(I18N).getLocale(),
	)
	try {
		await userStore.ensureLoaded(clientLocale)
	} catch (err) {
		logger.warn('Failed to hydrate user for follow reconcile; deferring', {
			error: err,
		})
		sessionStorage.removeItem(SessionKeys.followReconcileAttempted)
		return
	}

	const userId = userStore.current?.id
	if (!userId) {
		// No user id even after ensureLoaded (e.g. no cached id AND no email in
		// the JWT claims). Leave the session flag cleared so the next start can
		// retry once a user id exists.
		sessionStorage.removeItem(SessionKeys.followReconcileAttempted)
		logger.warn(
			'No user id available; deferring follow reconcile to next start',
		)
		return
	}

	if (followStore.hasReceipt(userId)) {
		// Receipt present → this account already migrated. The residual queue is
		// stale (a prior clear failed); clear WITHOUT re-migrating so reverted
		// state is not resurrected.
		logger.info(
			'Receipt present; clearing residual guest follows without migrating',
			{
				userId,
				residual: followStore.guestFollows.length,
			},
		)
		followStore.clearGuestFollows()
		return
	}

	// No receipt → first authenticated reconcile for this account. Migrate
	// (idempotent, per-item drain), which writes the receipt on success.
	logger.info('Reconciling leftover guest follows', {
		userId,
		queued: followStore.guestFollows.length,
	})
	await followStore.migrateGuestFollows(userId)

	// Clear whatever fully migrated. The per-item drain already removed
	// succeeded items; any survivors are genuine failures left for the next
	// reconcile (the receipt was NOT written, so they will be retried).
	if (followStore.hasReceipt(userId)) {
		followStore.clearGuestFollows()
	}
}

export const FollowReconcileTask = AppTask.activating(
	IContainer,
	runFollowReconcile,
)
