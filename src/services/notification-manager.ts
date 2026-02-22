import { DI, ILogger, observable, resolve } from 'aurelia'

export const INotificationManager = DI.createInterface<INotificationManager>(
	'INotificationManager',
	(x) => x.singleton(NotificationManager),
)

export interface INotificationManager extends NotificationManager {}

export class NotificationManager {
	private readonly logger = resolve(ILogger).scopeTo('NotificationManager')

	@observable public permission: NotificationPermission = 'default'

	constructor() {
		this.initPermissionWatch()
	}

	private async initPermissionWatch(): Promise<void> {
		if (!('Notification' in globalThis)) {
			this.logger.warn('Notification API not available')
			return
		}

		this.permission = Notification.permission

		try {
			const status = await navigator.permissions?.query({
				name: 'notifications',
			})
			if (!status) {
				this.logger.debug(
					'navigator.permissions not available, using Notification.permission',
				)
				return
			}
			this.permission = this.mapPermissionState(status.state)
			status.addEventListener('change', () => {
				this.permission = this.mapPermissionState(status.state)
				this.logger.info('Notification permission changed', {
					permission: this.permission,
				})
			})
		} catch {
			// Fallback: just use Notification.permission (some browsers do not
			// support permissions.query for notifications)
			this.logger.debug(
				'permissions.query not supported, using Notification.permission',
			)
		}
	}

	// The Permissions API returns 'prompt' while the Notification API uses
	// 'default' for the same undecided state. Map accordingly.
	private mapPermissionState(state: PermissionState): NotificationPermission {
		if (state === 'prompt') {
			return 'default'
		}
		return state as NotificationPermission
	}

	public async requestPermission(): Promise<NotificationPermission> {
		if (!('Notification' in globalThis)) {
			this.logger.warn('Notification API not available, returning denied')
			return 'denied'
		}

		this.permission = await Notification.requestPermission()
		this.logger.info('Notification permission result', {
			permission: this.permission,
		})
		return this.permission
	}
}
