import { DI } from 'aurelia'

export interface INavDimmingService {
	setDimmed(dimmed: boolean): void
}

export const INavDimmingService = DI.createInterface<INavDimmingService>(
	'INavDimmingService',
	(x) => x.singleton(NavDimmingService),
)

/** Dims or undims the bottom-nav tabs ([data-nav]) to guide focus during lane intro. */
export class NavDimmingService implements INavDimmingService {
	public setDimmed(dimmed: boolean): void {
		const navItems = document.body.querySelectorAll<HTMLElement>('[data-nav]')
		for (const item of navItems) {
			item.toggleAttribute('data-dimmed', dimmed)
		}
	}
}
