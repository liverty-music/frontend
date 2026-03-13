import { AppTask, IContainer, ILogger } from 'aurelia'
import { IAuthService } from './auth-service'
import { IUserService } from './user-service'

export const UserHydrationTask = AppTask.activating(
	IContainer,
	async (container: IContainer) => {
		const auth = container.get(IAuthService)
		await auth.ready

		if (auth.isAuthenticated) {
			const userService = container.get(IUserService)
			try {
				await userService.ensureLoaded()
			} catch (err) {
				const logger = container.get(ILogger).scopeTo('UserHydrationTask')
				logger.warn('Failed to hydrate user profile, continuing without it', {
					error: err,
				})
			}
		}
	},
)
