import { I18N } from '@aurelia/i18n'
import {
	IRouter,
	type IRouteViewModel,
	type NavigationInstruction,
} from '@aurelia/router'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { Toast } from './components/toast-notification/toast'
import { IAuthService } from './services/auth-service'
import { ILocalArtistClient } from './services/local-artist-client'
import {
	IOnboardingService,
	OnboardingStep,
} from './services/onboarding-service'

export class WelcomePage implements IRouteViewModel {
	private readonly authService = resolve(IAuthService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly localClient = resolve(ILocalArtistClient)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('WelcomePage')
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)

	/**
	 * Whether to show the [Get Started] primary CTA.
	 * Hidden when onboardingStep = COMPLETED (show Login only).
	 */
	public get showGetStarted(): boolean {
		return !this.onboarding.isCompleted
	}

	/**
	 * Router lifecycle hook - called before the component is loaded.
	 * Returns a redirect instruction instead of calling router.load() to avoid
	 * re-entrant navigation while the viewport is not yet registered (AUR3174).
	 */
	async canLoad(): Promise<NavigationInstruction | boolean> {
		this.logger.debug('Checking if landing page can load')

		await this.authService.ready

		// Authenticated users skip LP entirely
		if (this.authService.isAuthenticated) {
			this.logger.info('User is authenticated, redirecting to dashboard')
			return 'dashboard'
		}

		// If in tutorial (step 1-5), resume at the correct step
		if (this.onboarding.isOnboarding) {
			const route = this.onboarding.getRouteForCurrentStep()
			if (route) {
				this.logger.info('Resuming tutorial', {
					step: this.onboarding.currentStep,
					route,
				})
				return route
			}
		}

		return true
	}

	async handleGetStarted(): Promise<void> {
		this.logger.info('Get Started tapped, entering tutorial')
		this.localClient.clearAll()
		this.onboarding.setStep(OnboardingStep.DISCOVER)
		try {
			await this.router.load('discover')
		} catch (err) {
			this.logger.error('Failed to navigate to discover', { error: err })
			this.ea.publish(new Toast(this.i18n.tr('welcome.error.navigation')))
		}
	}

	async handleLogin(): Promise<void> {
		this.logger.info('Login tapped')
		try {
			await this.authService.signIn()
		} catch (err) {
			this.logger.error('Failed to start sign-in flow', { error: err })
			this.ea.publish(new Toast(this.i18n.tr('welcome.error.login')))
		}
	}
}
