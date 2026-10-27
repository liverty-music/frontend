import { I18N } from '@aurelia/i18n'
import type { NavigationInstruction } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { IUserRpcClient } from '../../adapter/rpc/client/user-client'
import type {
	DeletionBlocker,
	DeletionBlockerKind,
} from '../../entities/deletion-blocker'
import { IAnalyticsService } from '../../lib/analytics/analytics-service'
import { IAuthService } from '../../services/auth-service'
import {
	type FreshSignInSession,
	IFreshSignInService,
} from '../../services/fresh-sign-in-service'
import { currentLanguage } from '../../util/change-locale'

/** Where the read of the deletion blockers stands. */
export type BlockersState = 'loading' | 'ready' | 'error'

/**
 * Where the deletion stands: not asked yet, the call in flight, the fresh
 * sign-in or the call did not delete the account, or it is deleted.
 */
export type DeletionState =
	| 'idle'
	| 'deleting'
	| 'notDeleted'
	| 'failed'
	| 'deleted'

/** The catalog key of each blocker kind's line ("… {{count}} 枚"). */
const BLOCKER_KEYS: Record<DeletionBlockerKind, string> = {
	upcomingTicket: 'deleteAccount.blockers.upcomingTicket',
	listedResale: 'deleteAccount.blockers.listedResale',
	pendingLotteryEntry: 'deleteAccount.blockers.pendingLotteryEntry',
	paymentInProgress: 'deleteAccount.blockers.paymentInProgress',
	other: 'deleteAccount.blockers.other',
}

/** A blocker as listed: its catalog key and count. */
export interface ListedBlocker {
	readonly key: string
	readonly count: number
}

/**
 * The fan's withdrawal screen (`/settings/delete-account`, OpenSpec change
 * `delete-fan-accounts`, design D4-D6).
 *
 * It lists what blocks deletion (UserService.ListDeletionBlockers) and, when
 * nothing does, states what deletion means and offers the delete control.
 * Confirming sends the fan through the fresh sign-in passkey management uses;
 * the callback returns here, and the screen calls UserService.Delete with the
 * sign-in's ID token, which lives in memory only and is dropped once the call
 * returns or the fan leaves. After deletion the session is ended on this
 * device only (the identity no longer exists) and analytics stops identifying
 * the fan.
 */
export class DeleteAccountRoute {
	private readonly auth = resolve(IAuthService)
	private readonly freshSignIn = resolve(IFreshSignInService)
	private readonly users = resolve(IUserRpcClient)
	private readonly analytics = resolve(IAnalyticsService)
	private readonly i18n = resolve(I18N)
	private readonly logger = resolve(ILogger).scopeTo('DeleteAccountRoute')

	public blockersState: BlockersState = 'loading'
	public blockers: ListedBlocker[] = []
	public deletionState: DeletionState = 'idle'

	/** Bound via `ref` to the confirmation dialog and its Cancel control. */
	public confirmDialog?: HTMLDialogElement
	public confirmCancel?: HTMLButtonElement

	/** The delete control is offered only when nothing blocks deletion. */
	public get canDelete(): boolean {
		return (
			this.blockersState === 'ready' &&
			this.blockers.length === 0 &&
			this.deletionState !== 'deleting' &&
			this.deletionState !== 'deleted'
		)
	}

	public async canLoad(): Promise<boolean | NavigationInstruction> {
		await this.auth.ready
		if (!this.auth.isAuthenticated) return '/settings'
		return true
	}

	public loading(): void {
		const session = this.freshSignIn.sessionFor('deleteAccount')
		const returned = this.freshSignIn.takeReturn('deleteAccount')
		// Not awaited: the screen shows its own progress while the calls run.
		if (session) {
			void this.deleteWith(session)
			return
		}
		// Back without a sign-in: abandoned, failed or another account.
		if (returned) this.deletionState = 'notDeleted'
		void this.loadBlockers()
	}

	public attached(): void {
		// Leaving the hosted login with the browser's back may restore this page
		// from the bfcache: no route hook runs then, so check on `pageshow`.
		window.addEventListener('pageshow', this.onPageShow)
	}

	public detaching(): void {
		window.removeEventListener('pageshow', this.onPageShow)
		this.closeDialog()
	}

	public unloading(): void {
		// The proof of the fresh sign-in never outlives the screen.
		this.freshSignIn.discard()
	}

	private readonly onPageShow = (event: PageTransitionEvent): void => {
		if (!event.persisted) return
		if (this.freshSignIn.takeReturn('deleteAccount')) {
			this.deletionState = 'notDeleted'
		}
	}

	/** Read the blockers; also the retry of a failed read. */
	public async loadBlockers(): Promise<void> {
		this.blockersState = 'loading'
		try {
			const blockers = await this.users.listDeletionBlockers()
			this.blockers = blockers.map(toListed)
			this.blockersState = 'ready'
		} catch (err) {
			if (!(err instanceof ConnectError)) throw err
			this.logger.warn('Failed to read the deletion blockers', {
				code: err.code,
			})
			this.blockersState = 'error'
		}
	}

	/** Open the confirmation dialog; its Cancel control takes focus. */
	public askDelete(): void {
		if (!this.canDelete) return
		// Guarded: jsdom does not implement showModal.
		try {
			this.confirmDialog?.showModal()
		} catch {
			/* non-interactive environment */
		}
		// The action cannot be undone, so the safe choice takes focus first
		// (WAI-ARIA APG dialog pattern).
		this.confirmCancel?.focus()
	}

	public cancelDelete(): void {
		this.closeDialog()
	}

	/** Confirmed: sign in again, then the callback brings the fan back here. */
	public async confirmDelete(): Promise<void> {
		this.closeDialog()
		if (!this.canDelete) return
		await this.signInAgain()
	}

	/** Retry of a failed deletion: the proof was dropped, so sign in again. */
	public async retryDelete(): Promise<void> {
		await this.signInAgain()
	}

	private async signInAgain(): Promise<void> {
		this.freshSignIn.discard()
		await this.freshSignIn.start('deleteAccount', {
			loginHint: this.auth.user?.profile.email,
			uiLocales: currentLanguage(this.i18n),
		})
	}

	private async deleteWith(session: FreshSignInSession): Promise<void> {
		this.deletionState = 'deleting'
		// The callback already refuses another account; the screen checks
		// again before it sends the proof.
		if (!session.idToken || session.userId !== this.auth.user?.profile.sub) {
			this.logger.warn('Fresh sign-in is not usable for deletion')
			this.freshSignIn.discard()
			this.deletionState = 'notDeleted'
			await this.loadBlockers()
			return
		}
		try {
			await this.users.delete(session.idToken)
		} catch (err) {
			if (!(err instanceof ConnectError)) throw err
			this.logger.warn('Account deletion failed', { code: err.code })
			// Something started meanwhile (e.g. a ticket bought in another tab):
			// show what blocks deletion now.
			this.deletionState =
				err.code === Code.FailedPrecondition ? 'idle' : 'failed'
			await this.loadBlockers()
			return
		} finally {
			this.freshSignIn.discard()
		}
		// The account is gone whatever happens next; a failure to clear the
		// stored session only leaves a token that no longer signs in.
		try {
			await this.auth.signOutLocally()
		} catch (err) {
			this.logger.warn('Failed to clear the session after deletion', err)
		}
		this.analytics.reset()
		this.deletionState = 'deleted'
	}

	private closeDialog(): void {
		try {
			if (this.confirmDialog?.open) this.confirmDialog.close()
		} catch {
			/* non-interactive environment */
		}
	}
}

function toListed(blocker: DeletionBlocker): ListedBlocker {
	return { key: BLOCKER_KEYS[blocker.kind], count: blocker.count }
}
