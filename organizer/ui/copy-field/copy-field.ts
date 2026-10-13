import { bindable } from 'aurelia'

/**
 * A value to hand on (a fan page address) shown with its label and a copy
 * button (`<copy-button>`), which confirms the copy.
 */
export class CopyField {
	@bindable public label = ''
	@bindable public value = ''
}
