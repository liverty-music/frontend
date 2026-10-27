import { DeletionBlocker_Kind } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/deletion_blocker_pb.js'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { EMAIL_MAX_LENGTH, emailProblem } from '../../shared/utils/email'
import { toUserMessage } from '../services/error-message'
import {
	type DeletionBlocker,
	type FoundUser,
	IAdminUserClient,
} from '../services/user-client'

/** Where the lookup stands. */
export type LookupPhase = 'idle' | 'loading' | 'found' | 'notFound' | 'error'

/** A blocker as shown: what it is and how many. */
export interface BlockerRow {
	readonly label: string
	readonly count: number
}

/** The found User, flattened for the template. */
export interface UserRow {
	readonly id: string
	readonly name: string
	readonly email: string
	readonly blockers: readonly BlockerRow[]
}

const EMPTY = '—'

const BLOCKER_LABELS: Partial<Record<DeletionBlocker_Kind, string>> = {
	[DeletionBlocker_Kind.UPCOMING_TICKET]: 'Tickets for upcoming concerts',
	[DeletionBlocker_Kind.LISTED_RESALE]: 'Resale listings on sale',
	[DeletionBlocker_Kind.PENDING_LOTTERY_ENTRY]:
		'Lottery entries awaiting the draw',
	[DeletionBlocker_Kind.PAYMENT_IN_PROGRESS]: 'Purchases being paid',
}

function toBlockerRow(blocker: DeletionBlocker): BlockerRow {
	return {
		label: BLOCKER_LABELS[blocker.kind] ?? 'Other things in progress',
		count: blocker.count,
	}
}

function toUserRow(found: FoundUser): UserRow {
	const user = found.user
	return {
		id: user?.id?.value ?? '',
		name: user?.name || EMPTY,
		email: user?.email?.value ?? EMPTY,
		blockers: found.blockers.map(toBlockerRow),
	}
}

/**
 * The admin console's Users screen (OpenSpec change `delete-fan-accounts`,
 * spec `route/users`): an admin finds one fan's account by email address,
 * sees what blocks its deletion and deletes it at the fan's request.
 *
 * It lists no Users other than the one found, and keeps the typed email only
 * in its own field. Delete is offered only when nothing blocks deletion, and
 * runs only from the confirmation dialog's Delete control.
 */
export class UsersRoute {
	private readonly client = resolve(IAdminUserClient)
	private readonly logger = resolve(ILogger).scopeTo('UsersRoute')

	public readonly emailMaxLength = EMAIL_MAX_LENGTH

	/** The email field. */
	public email = ''
	public emailError = ''

	public phase: LookupPhase = 'idle'
	public lookupError = ''
	public found: UserRow | null = null

	/** Delete state. */
	public dialogOpen = false
	public deleting = false
	public deleteError = ''
	/** Set after a deletion: the address whose account was deleted. */
	public deletedEmail = ''

	/** Bound via `ref` to the confirmation dialog and its Cancel control. */
	public deleteDialog?: HTMLDialogElement
	public deleteCancelButton?: HTMLButtonElement

	public get canDelete(): boolean {
		return this.found !== null && this.found.blockers.length === 0
	}

	/** Submit of the email field. */
	public async lookUp(): Promise<void> {
		const email = this.email.trim()
		switch (emailProblem(email)) {
			case 'empty':
				this.emailError = 'Enter an email address.'
				return
			case 'tooLong':
				this.emailError = `The email address must be ${EMAIL_MAX_LENGTH} characters or fewer.`
				return
			case 'invalid':
				this.emailError = 'Enter a valid email address.'
				return
		}
		this.emailError = ''
		this.deletedEmail = ''
		this.deleteError = ''
		await this.load(email)
	}

	private async load(email: string): Promise<void> {
		this.phase = 'loading'
		this.found = null
		this.lookupError = ''
		try {
			this.found = toUserRow(await this.client.getByEmail(email))
			this.phase = 'found'
		} catch (err) {
			if (err instanceof ConnectError && err.code === Code.NotFound) {
				this.phase = 'notFound'
				return
			}
			this.logger.error('Look up user failed', { err })
			this.lookupError = toUserMessage(err, 'Failed to look up the account.', {
				[Code.InvalidArgument]: 'Enter a valid email address.',
			})
			this.phase = 'error'
		}
	}

	/** Open the confirmation dialog; its Cancel control takes focus. */
	public requestDelete(): void {
		if (!this.canDelete || this.deleting) return
		this.deleteError = ''
		this.dialogOpen = true
		// Guarded: jsdom does not implement showModal.
		try {
			this.deleteDialog?.showModal()
		} catch {
			/* non-interactive environment: VM state still drives the flow */
		}
		// The action is permanent, so the least destructive control takes focus
		// (WAI-ARIA APG dialog pattern).
		this.deleteCancelButton?.focus()
	}

	public cancelDelete(): void {
		this.closeDialog()
	}

	/** Runs on every close of the dialog, Escape included. */
	public onDialogClose(): void {
		this.dialogOpen = false
	}

	public async confirmDelete(): Promise<void> {
		const user = this.found
		if (!user || !this.dialogOpen || this.deleting || !this.canDelete) return
		this.deleting = true
		try {
			await this.client.delete(user.id)
			this.deletedEmail = user.email
			this.found = null
			this.phase = 'idle'
		} catch (err) {
			if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
				// Something started meanwhile: show the User's blockers now.
				this.logger.warn('Delete user refused; reading the blockers again', {
					userId: user.id,
				})
				await this.load(user.email)
				return
			}
			this.logger.error('Delete user failed', { userId: user.id, err })
			this.deleteError = toUserMessage(err, 'Failed to delete the account.')
		} finally {
			this.deleting = false
			this.closeDialog()
		}
	}

	private closeDialog(): void {
		this.dialogOpen = false
		try {
			this.deleteDialog?.close()
		} catch {
			/* non-interactive environment */
		}
	}
}
