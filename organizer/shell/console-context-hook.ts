import type {
	IRouteViewModel,
	NavigationInstruction,
	Params,
	RouteNode,
} from '@aurelia/router'
import { type ILifecycleHooks, ILogger, lifecycleHooks, resolve } from 'aurelia'
import { paths } from '../model/concert-model'
import { IConsoleContext } from './console-context'

/**
 * Places every screen under the Organizer and Artist of its address (design
 * D1). Registered after `OrganizerAuthHook`, so it runs for an admitted owner
 * only:
 *
 * - `canLoad`: an address naming another Organizer opens the page saying so;
 *   no screen of it loads. When the caller's Organizer cannot be read the
 *   screen opens and reports its own failure; the backend stays the authority.
 * - `loading`: once every guard has passed, the console follows the address's
 *   Artist, so links and the Artist menu name it before the screen renders.
 *
 * Screens without an Organizer in their address (sign-in, access denied, the
 * event's tabs, which are child routes) are left alone.
 */
@lifecycleHooks()
export class ConsoleContextHook
	implements ILifecycleHooks<IRouteViewModel, 'canLoad' | 'loading'>
{
	private readonly context = resolve(IConsoleContext)
	private readonly logger = resolve(ILogger).scopeTo('ConsoleContextHook')

	async canLoad(
		_vm: IRouteViewModel,
		params: Params,
		_next: RouteNode,
		_current: RouteNode | null,
	): Promise<boolean | NavigationInstruction> {
		const organizerId = params.organizerId
		if (!organizerId) return true
		try {
			await this.context.load()
		} catch (err) {
			this.logger.warn('Own organizer unavailable; address not checked', err)
			return true
		}
		if (this.context.isOtherOrganizer(organizerId)) {
			this.logger.info('Address names another organizer')
			return paths.otherOrganizer
		}
		return true
	}

	loading(_vm: IRouteViewModel, params: Params): void {
		if (!params.organizerId) return
		this.context.follow({
			organizerId: params.organizerId,
			artistId: params.artistId,
		})
	}
}
