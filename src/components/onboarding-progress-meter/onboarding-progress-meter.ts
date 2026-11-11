import { bindable } from 'aurelia'

/**
 * The band of light on the onboarding progress row: a groove filled up to
 * `percent`, with a spark at its leading edge that flares on every rise.
 * `onboarding-progress` places it in its row and labels it.
 */
export class OnboardingProgressMeter {
	/** How full the band is, from 0 to 100. */
	@bindable public percent = 0

	/** 0 or 1, alternating with every rise of the value (see the spark). */
	@bindable public rise = 0

	/** The id of the element that names the progress bar. */
	@bindable public labelledBy = ''
}
