import { bindable } from 'aurelia'

/**
 * The spark at the leading edge of the onboarding band. It sits inside the
 * band (`onboarding-progress-meter`), which sets `--progress`, and flares once
 * whenever `rise` changes.
 */
export class OnboardingProgressSpark {
	/**
	 * 0 or 1, alternating with every rise of the value: the stylesheet
	 * switches between two identical keyframes, which restarts the flare.
	 */
	@bindable public rise = 0
}
