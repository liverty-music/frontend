import { DI, ILogger, resolve } from 'aurelia'

export const ICoachMarkService = DI.createInterface<ICoachMarkService>(
	'ICoachMarkService',
	(x) => x.singleton(CoachMarkService),
)

export interface ICoachMarkService extends CoachMarkService {}

/**
 * Owns the state of the single, transient, non-blocking coach mark.
 *
 * Extracted from `OnboardingService` so onboarding state can be a pure flag. The
 * `<coach-mark>` component is placed once at the app-shell level and binds to
 * these plain (auto-observed) properties. At most one coach mark is active at a
 * time. `onTap` performs navigation/incidental side effects only — it never
 * advances an onboarding step (there is no step machine).
 */
export class CoachMarkService {
	private readonly logger = resolve(ILogger).scopeTo('CoachMarkService')

	// Spotlight state — plain properties, auto-observed by Aurelia templates.
	public target = ''
	public message = ''
	public radius = '12px'
	public active = false

	// Callback — not state, cannot live in a store.
	public onTap: (() => void) | undefined = undefined

	/**
	 * Activate the spotlight on a target element.
	 * @param target component-scoped CSS selector for the highlight target
	 * @param message instructional tooltip text
	 * @param onTap optional incidental side effect (never step advancement)
	 * @param radius spotlight cutout radius
	 */
	public activate(
		target: string,
		message: string,
		onTap?: () => void,
		radius = '12px',
	): void {
		this.logger.info('Coach mark activated', { target })
		this.target = target
		this.message = message
		this.radius = radius
		this.onTap = onTap
		this.active = true
	}

	/** Deactivate the spotlight entirely. */
	public deactivate(): void {
		this.target = ''
		this.message = ''
		this.radius = '12px'
		this.active = false
		this.onTap = undefined
	}
}
