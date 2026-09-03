import { DI, observable } from 'aurelia'
import {
	type Handedness,
	loadHanded,
	saveHanded,
} from '../adapter/storage/fab-preference-storage'

export type { Handedness }

/**
 * Signal name for the `& signal` binding behavior on the launcher's toggle/active
 * bindings. An action's `isOn()` reads route state through a closure that Aurelia
 * cannot observe from the `<fab-menu>` binding context; dispatching this signal
 * (on panel-open and after a toggle) forces those bindings to re-read `isOn()`.
 */
export const FAB_MENU_SIGNAL = 'fab-menu:state'

/**
 * A single launcher action. Every action carries a text label (labels are
 * mandatory — no icon-only items) alongside its icon.
 *
 * - `command`: a one-shot action (opens a sheet, switches view). On tap the
 *   launcher panel closes so at most one overlay is active. `isOn` is optional
 *   and, when present, drives a `data-active` visual indicator (e.g. the filter
 *   item lighting up while a filter is applied) — NOT an `aria-pressed` state.
 * - `toggle`: an inline persistent on/off control (the beam effect). `isOn`
 *   reflects the current state to assistive technology via `aria-pressed`; the
 *   panel stays open on tap.
 */
export interface FabAction {
	/** Stable id, unique within a single owner's set. */
	id: string
	/** i18n key for the visible text label. */
	labelKey: string
	/** `svg-icon` name. */
	icon: string
	kind: 'command' | 'toggle'
	/** Current on-state (toggle) or active indicator (command). */
	isOn?: () => boolean
	/** Perform the action. Any return value is ignored. */
	invoke: () => void
}

/**
 * Shared factory for the per-page "help" launcher action, so its id / label /
 * icon are defined once rather than copy-pasted at each contributing route
 * (discovery, dashboard, my-artists). `invoke` opens that page's help sheet.
 */
export function helpAction(invoke: () => void): FabAction {
	return {
		id: 'help',
		labelKey: 'fabMenu.help',
		icon: 'help-circle',
		kind: 'command',
		invoke,
	}
}

export const IFabMenuService = DI.createInterface<IFabMenuService>(
	'IFabMenuService',
	(x) => x.singleton(FabMenuService),
)

export interface IFabMenuService extends FabMenuService {}

/**
 * Registry backing the global `<fab-menu>` launcher. Routes contribute their
 * contextual actions on activation and dispose them on deactivation, so the
 * launcher's contents adapt per page. Modeled on the snack-bar precedent (a DI
 * singleton owned by the shell, rendering-decoupled from the routes that drive
 * it) — see design.md D1.
 */
export class FabMenuService {
	/**
	 * Flattened, ordered action list bound by `<fab-menu>`. Reassigned (not
	 * mutated in place) on every register/dispose so Aurelia's observation
	 * re-renders the panel and the FAB visibility gate (`actions.length`).
	 */
	@observable public actions: FabAction[] = []

	/** Persisted launcher placement; mirrors the beam-preference pattern (D6). */
	@observable public handed: Handedness = loadHanded()

	/**
	 * Owner-keyed action sets. A re-register by the same owner REPLACES that
	 * owner's set (idempotent), so a within-route mode change never accumulates
	 * or duplicates items. `Map` preserves owner insertion order, keeping the
	 * flattened order stable across a single owner's re-registrations (D2).
	 */
	private readonly byOwner = new Map<object, FabAction[]>()

	/**
	 * Contribute `actions` for `owner`, returning a disposer. Calling `register`
	 * again for the same owner replaces its previous set. The disposer removes
	 * the owner's set and is idempotent — routes push it onto their
	 * `subscriptions` and call it in `detaching()`, mirroring the listener
	 * lifetime discipline enforced elsewhere in the codebase.
	 */
	public register(owner: object, actions: FabAction[]): () => void {
		this.byOwner.set(owner, actions)
		this.rebuild()
		return () => {
			if (this.byOwner.delete(owner)) {
				this.rebuild()
			}
		}
	}

	/** Whether the launcher is placed on the left (left-handed mode). */
	public get isLeftHanded(): boolean {
		return this.handed === 'left'
	}

	/** Flip the placement between right- and left-handed and persist it. */
	public toggleHanded(): void {
		this.setHanded(this.handed === 'left' ? 'right' : 'left')
	}

	/** Set the placement explicitly and persist it via the storage adapter. */
	public setHanded(handed: Handedness): void {
		this.handed = handed
		saveHanded(handed)
	}

	private rebuild(): void {
		const next: FabAction[] = []
		for (const set of this.byOwner.values()) {
			next.push(...set)
		}
		this.actions = next
	}
}
