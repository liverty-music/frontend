import { DI, IEventAggregator, ILogger, observable, resolve } from 'aurelia'
import { INotificationRpcClient } from '../adapter/rpc/client/notification-client'
import type { Notification } from '../entities/notification'
import { IAuthService } from './auth-service'
import { SignedOut } from './events/signed-out'

export const INotificationStore = DI.createInterface<INotificationStore>(
	'INotificationStore',
	(x) => x.singleton(NotificationStore),
)

export interface INotificationStore extends NotificationStore {}

/**
 * - `loading`: the first read is in progress.
 * - `ready`: `notifications` holds the last response.
 * - `error`: the last read failed.
 */
export type NotificationListState = 'loading' | 'ready' | 'error'

/**
 * Owner of the last `NotificationService.List` response, read by the bell in
 * the shell header and by the notification center. The app shell refreshes it
 * on start and when the app returns to the foreground; marking a notification
 * read refreshes it too.
 */
export class NotificationStore {
	private readonly logger = resolve(ILogger).scopeTo('NotificationStore')
	private readonly rpcClient = resolve(INotificationRpcClient)
	private readonly auth = resolve(IAuthService)
	private readonly ea = resolve(IEventAggregator)

	@observable public notifications: readonly Notification[] = []
	@observable public state: NotificationListState = 'loading'

	private listing: AbortController | null = null

	constructor() {
		this.ea.subscribe(SignedOut, () => this.clear())
	}

	/** How many of the listed notifications the fan has not read. */
	public get unreadCount(): number {
		return this.notifications.filter((n) => !n.readTime).length
	}

	/**
	 * Read the list again, replacing the previous response when it arrives. A
	 * newer refresh cancels an older one, so a late response never overwrites a
	 * newer one. The previous list stays while the read is in progress and when
	 * it fails. Does nothing for a guest.
	 */
	public async refresh(): Promise<void> {
		if (!this.auth.isAuthenticated) return
		this.listing?.abort()
		const listing = new AbortController()
		this.listing = listing
		try {
			const notifications = await this.rpcClient.list(listing.signal)
			if (listing.signal.aborted) return
			this.notifications = notifications
			this.state = 'ready'
		} catch (err) {
			if (listing.signal.aborted) return
			this.logger.warn('Notification list refresh failed', { error: err })
			this.state = 'error'
		}
	}

	/**
	 * Mark a notification read: optimistically, rolling back when the server
	 * refuses. It never rejects, so a failure cannot stop the caller from opening
	 * the notification's link.
	 */
	public async markRead(id: string): Promise<void> {
		const before = this.notifications
		this.notifications = before.map((n) =>
			n.id === id && !n.readTime ? { ...n, readTime: new Date() } : n,
		)
		try {
			await this.rpcClient.markRead(id)
		} catch (err) {
			this.logger.warn('Marking a notification read failed', { error: err })
			this.notifications = before
			return
		}
		await this.refresh()
	}

	/** Forget the signed-in fan's notifications. */
	public clear(): void {
		this.listing?.abort()
		this.listing = null
		this.notifications = []
		this.state = 'loading'
	}
}
