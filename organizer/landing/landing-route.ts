import { IRouter, type NavigationInstruction } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { paths } from '../model/concert-model'
import { IConsoleContext } from '../shell/console-context'

/**
 * `/` and every address the console does not know: opens the Home of the
 * caller's Organizer (design D1), whose id only `OrganizerService.Get` knows.
 * When it cannot be read the page says so and offers 再試行.
 */
export class LandingRoute {
	private readonly context = resolve(IConsoleContext)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('LandingRoute')

	public failed = false

	public async canLoad(): Promise<boolean | NavigationInstruction> {
		const home = await this.home()
		return home ?? true
	}

	public async retry(): Promise<void> {
		const home = await this.home()
		if (home) await this.router.load(home)
	}

	private async home(): Promise<string | null> {
		try {
			await this.context.load()
			this.failed = !this.context.ownOrganizerId
			return this.failed ? null : paths.home(this.context.ownOrganizerId)
		} catch (err) {
			this.logger.warn('Own organizer unavailable', err)
			this.failed = true
			return null
		}
	}
}
