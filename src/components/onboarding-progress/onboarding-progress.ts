import { bindable } from 'aurelia'

/**
 * How close the fan's onboarding timetable is to ready, shown on Discovery
 * under the genre chips: a band of light that fills with every follow. At
 * ready it becomes the link that opens the Dashboard. The caller decides when
 * the row exists (onboarding only, not in search mode) and computes `value`.
 */
export class OnboardingProgress {
	/** Readiness from 0 to 1 (see `timetableReadiness`). */
	@bindable public value = 0

	/**
	 * Counts the rises of the value, so the leading spark flares once per
	 * follow: the template alternates between two identical keyframes, which
	 * restarts the animation.
	 */
	public rises = 0

	public get percent(): number {
		return Math.round(Math.min(1, Math.max(0, Number(this.value) || 0)) * 100)
	}

	public get ready(): boolean {
		return this.percent >= 100
	}

	public valueChanged(next: number, previous: number): void {
		if (Number(next) > Number(previous)) this.rises += 1
	}
}
