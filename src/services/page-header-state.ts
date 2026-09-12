import { DI, observable } from 'aurelia'

/**
 * The page-identity snapshot the shell header and the bottom nav read from: the
 * i18n title key, whether the title opts into a View-Transition morph, and the
 * absolute path used to compute the active nav tab.
 */
export interface PageIdentity {
	titleKey: string
	morphTitle: boolean
	activePath: string
}

export const IPageHeaderState = DI.createInterface<IPageHeaderState>(
	'IPageHeaderState',
	(x) => x.singleton(PageHeaderState),
)

export interface IPageHeaderState extends PageHeaderState {}

/**
 * Single source of truth for the current page's identity — the shell-hosted
 * `<page-header>` title and the active bottom-nav tab. Both are pure functions
 * of this observable state, so page identity can switch at navigation intent
 * (optimistically, on `navigation-start`) independent of the incoming route's
 * module load and entrance transition.
 *
 * The shell drives the lifecycle: {@link setOptimistic} on navigation-start,
 * {@link confirm} on navigation-end (authoritative — covers redirects, the
 * not-found fallback, and dynamic titles), and {@link rollback} on
 * navigation-error. The active route may push a dynamic title in place via
 * {@link setTitle} (the dashboard My Timetable ↔ All Nearby swap).
 */
export class PageHeaderState {
	/** i18n key rendered into the shell header's `<h1>`. */
	@observable public titleKey = ''
	/** Opt-in `view-transition-name` on the title, for in-place morphs. */
	@observable public morphTitle = false
	/** Absolute path of the current page; the nav highlight is derived from it. */
	@observable public activePath = ''

	/**
	 * The last confirmed (navigation-end) identity. A failed navigation rolls the
	 * state back to this so the header title and active tab keep matching the
	 * route that remains displayed. Dynamic in-place title updates fold into it so
	 * a later rollback preserves them.
	 */
	private lastConfirmed: PageIdentity = {
		titleKey: '',
		morphTitle: false,
		activePath: '',
	}

	/**
	 * Optimistic set at navigation-start, from the target route. Applied
	 * immediately so the tap is acknowledged before the incoming content loads.
	 * Does NOT record a confirmed snapshot — only navigation-end does.
	 */
	public setOptimistic(identity: PageIdentity): void {
		this.apply(identity)
	}

	/**
	 * Authoritative reconcile at navigation-end. Overrides any optimistic guess
	 * (redirect, fallback, dynamic title) and records the confirmed snapshot used
	 * for rollback.
	 */
	public confirm(identity: PageIdentity): void {
		this.apply(identity)
		this.lastConfirmed = { ...identity }
	}

	/** Restore the last confirmed identity after a navigation error. */
	public rollback(): void {
		this.apply(this.lastConfirmed)
	}

	/**
	 * Update the title in place while the current route stays active — used by the
	 * dashboard's My Timetable ↔ All Nearby swap. `morph` gives the `<h1>` a stable
	 * `view-transition-name` so the text can morph across a same-document View
	 * Transition. Folds into the confirmed snapshot so a subsequent rollback keeps
	 * the dynamic title, not the route's static one.
	 */
	public setTitle(key: string, opts?: { morph?: boolean }): void {
		this.titleKey = key
		this.morphTitle = opts?.morph ?? false
		this.lastConfirmed = {
			...this.lastConfirmed,
			titleKey: this.titleKey,
			morphTitle: this.morphTitle,
		}
	}

	private apply(identity: PageIdentity): void {
		this.titleKey = identity.titleKey
		this.morphTitle = identity.morphTitle
		this.activePath = identity.activePath
	}
}
