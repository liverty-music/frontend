import { bindable } from 'aurelia'

/**
 * How close the fan's onboarding timetable is to ready, shown on Discovery
 * under the genre chips. Below ready it is a labelled bar; at ready it becomes
 * the link that opens the Dashboard. The caller decides when the row exists
 * (onboarding only, not in search mode) and computes `value`.
 */
export class OnboardingProgress {
	/** Readiness from 0 to 1 (see `timetableReadiness`). */
	@bindable public value = 0

	public get percent(): number {
		return Math.round(Math.min(1, Math.max(0, Number(this.value) || 0)) * 100)
	}

	public get ready(): boolean {
		return this.percent >= 100
	}
}
