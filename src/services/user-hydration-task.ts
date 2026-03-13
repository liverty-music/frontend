import { IContainer, AppTask } from 'aurelia'
import { IAuthService } from './auth-service'
import { IUserService } from './user-service'

export const UserHydrationTask = AppTask.activating(
	IContainer,
	async (container: IContainer) => {
		const auth = container.get(IAuthService)
		await auth.ready

		if (auth.isAuthenticated) {
			const userService = container.get(IUserService)
			await userService.ensureLoaded()
		}
	},
)
