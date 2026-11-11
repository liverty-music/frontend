import { bindable } from 'aurelia'

/**
 * The words of a celebration: a headline that scales in, then an optional
 * line below it and an optional hint, each entering a step later. The
 * celebration overlay lays them out over its scrim.
 */
export class CelebrationMessage {
	@bindable public message = ''
	@bindable public subMessage = ''
	@bindable public hint = ''
}
