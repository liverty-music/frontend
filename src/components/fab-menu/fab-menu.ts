import { ISignaler, resolve } from 'aurelia'
import {
	FAB_MENU_SIGNAL,
	type FabAction,
	IFabMenuService,
} from '../../services/fab-menu-service'

/**
 * Global thumb-zone action launcher. A single instance is mounted by the app
 * shell and binds to `IFabMenuService.actions` (contributed per route). The
 * collapsed FAB is a disclosure control (`aria-expanded` + `aria-controls`),
 * NOT an ARIA menu (design D5); the expanded panel is a top-layer
 * `popover="auto"` so Escape + light-dismiss come for free.
 *
 * The FAB itself is a `popover="manual"` shown on attach so it floats in the
 * browser top layer rather than competing on `z-index` — matching the app's
 * established overlay convention (snack-bar / bottom-sheet).
 */
export class FabMenu {
	public readonly fabMenu = resolve(IFabMenuService)
	private readonly signaler = resolve(ISignaler)

	public isOpen = false

	private fabButton!: HTMLButtonElement
	private panel!: HTMLElement
	/**
	 * Suppresses the return-focus-to-FAB when a command closes the panel to open
	 * another surface (the sheet must keep focus). Reset in the toggle handler.
	 */
	private suppressRefocus = false

	public attached(): void {
		// Promote the collapsed FAB into the top layer. showPopover throws if it
		// is already shown (defensive re-entry) — ignore that.
		try {
			this.fabButton.showPopover()
		} catch {
			// Already shown.
		}
	}

	public detaching(): void {
		// Close both popovers before teardown so an open panel is not torn out of
		// the top layer with focus stranded (e.g. a programmatic navigation while
		// the panel is expanded).
		try {
			this.panel.hidePopover()
		} catch {
			// Already hidden.
		}
		try {
			this.fabButton.hidePopover()
		} catch {
			// Already hidden.
		}
	}

	/** Keep `isOpen` and focus in sync with the panel's native open/close. */
	public onPanelToggle(event: ToggleEvent): void {
		const open = event.newState === 'open'
		this.isOpen = open
		if (open) {
			// Re-read every item's isOn() (e.g. the filter's active state may have
			// changed while the panel was closed).
			this.signaler.dispatchSignal(FAB_MENU_SIGNAL)
			// Move focus into the panel (first action item) on open.
			this.panel.querySelector<HTMLElement>('.fab-item')?.focus()
		} else if (this.suppressRefocus) {
			this.suppressRefocus = false
		} else {
			// Esc / light-dismiss / FAB re-tap → return focus to the FAB.
			this.fabButton.focus()
		}
	}

	public onAction(action: FabAction): void {
		if (action.kind === 'command') {
			// A command opens another surface; close the panel so only one overlay
			// is active, and let that surface keep focus (don't yank it back).
			this.suppressRefocus = true
			try {
				this.panel.hidePopover()
			} catch {
				this.suppressRefocus = false
			}
		}
		try {
			action.invoke()
		} finally {
			// A toggle mutates state in place (the panel stays open); re-read the
			// aria-pressed / data-active bindings. In `finally` so the UI still
			// reflects the flip even if invoke() throws after mutating state.
			if (action.kind === 'toggle') {
				this.signaler.dispatchSignal(FAB_MENU_SIGNAL)
			}
		}
	}

	/** `aria-pressed` value for toggle items only (commands get no pressed state). */
	public isPressed(action: FabAction): boolean {
		return action.kind === 'toggle' && (action.isOn?.() ?? false)
	}

	/** `data-active` visual indicator — toggle on-state or a command's active hint. */
	public isActive(action: FabAction): boolean {
		return action.isOn?.() ?? false
	}
}
