import { bindable } from 'aurelia'
import type { MenuAction as Action } from '../../../services/action-menu-service'

/**
 * One action on the launcher's arc: a 48 px circular icon target with its
 * label beside it. The label is inside the button, so it names it and takes
 * taps too. A tap reaches `action-menu` as the button's own `click`.
 */
export class ActionMenuItem {
	@bindable public action!: Action
	/** Shown in the filled "on" treatment: a toggle's on-state or an active command. */
	@bindable public active = false
	/** `aria-pressed` for a toggle; `null` leaves a command without the attribute. */
	@bindable public pressed: boolean | null = null
}
