import { I18N } from '@aurelia/i18n'
import {
	IRouter,
	type IRouteViewModel,
	type NavigationInstruction,
} from '@aurelia/router'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { Snack } from '../../components/snack-bar/snack'
import { IAuthService } from '../../services/auth-service'
import { IGuestService } from '../../services/guest-service'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import { changeLocale, SUPPORTED_LANGUAGES } from '../../util/change-locale'

export class WelcomeRoute implements IRouteViewModel {
	private readonly authService = resolve(IAuthService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly guest = resolve(IGuestService)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('WelcomeRoute')
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)

	public readonly supportedLanguages = SUPPORTED_LANGUAGES

	public isCurrentLanguage(lang: string): boolean {
		return this.i18n.getLocale() === lang
	}

	public async selectLanguage(lang: string): Promise<void> {
		if (lang === this.i18n.getLocale()) return
		await changeLocale(this.i18n, lang)
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

		// If in onboarding, resume at the correct step
		if (this.onboarding.isOnboarding) {
			const route = this.onboarding.getRouteForCurrentStep()
			if (route) {
				this.logger.info('Resuming onboarding', {
					step: this.onboarding.currentStep,
					route,
				})
				return route
			}
		}

		return true
	}

	async handleGetStarted(): Promise<void> {
		this.logger.info('Get Started tapped, entering onboarding')
		this.guest.clearAll()
		this.onboarding.reset()
		this.onboarding.setStep(OnboardingStep.DISCOVERY)
		try {
			await this.router.load('discovery')
		} catch (err) {
			this.logger.error('Failed to navigate to discovery', { error: err })
			this.ea.publish(new Snack(this.i18n.tr('welcome.error.navigation')))
		}
	}

	async handleLogin(): Promise<void> {
		this.logger.info('Login tapped')
		try {
			await this.authService.signIn()
		} catch (err) {
			this.logger.error('Failed to start sign-in flow', { error: err })
			this.ea.publish(new Snack(this.i18n.tr('welcome.error.login')))
		}
	}
}
