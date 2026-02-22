import { DI, ILogger, resolve } from 'aurelia'

export const INotificationManager = DI.createInterface<INotificationManager>(
	'INotificationManager',
	(x) => x.singleton(NotificationManager),
)

export interface INotificationManager extends NotificationManager {}

export class NotificationManager {
	private readonly logger = resolve(ILogger).scopeTo('NotificationManager')

	public permission: NotificationPermission = 'default'

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
			const status = await navigator.permissions.query({
				name: 'notifications',
			})
			this.permission = status.state as NotificationPermission
			status.addEventListener('change', () => {
				this.permission = status.state as NotificationPermission
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
