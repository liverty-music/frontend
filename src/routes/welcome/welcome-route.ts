import { I18N } from '@aurelia/i18n'
import {
	IRouter,
	type IRouteViewModel,
	type NavigationInstruction,
} from '@aurelia/router'
import { IEventAggregator, ILogger, INode, observable, resolve } from 'aurelia'
import { Snack } from '../../components/snack-bar/snack'
import {
	PREVIEW_ARTIST_IDS,
	PREVIEW_ARTIST_NAME_MAP,
	PREVIEW_MIN_ARTISTS_WITH_CONCERTS,
} from '../../constants/preview-artists'
import type { Artist } from '../../entities/artist'
import type { DateGroup } from '../../entities/concert'
import type { Hype } from '../../entities/follow'
import { IAuthService } from '../../services/auth-service'
import { IConcertService } from '../../services/concert-service'
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
	private readonly concertService = resolve(IConcertService)
	private readonly host = resolve(INode) as HTMLElement

	public readonly supportedLanguages = SUPPORTED_LANGUAGES
	@observable public currentLocale: string = ''

	/** Preview concert data for the read-only dashboard on the welcome page. */
	public dateGroups: DateGroup[] = []

	private abortController: AbortController | null = null

	public attached(): void {
		this.currentLocale = this.i18n.getLocale()
		void this.loadPreviewData()
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
	}

	private async loadPreviewData(): Promise<void> {
		if (PREVIEW_ARTIST_IDS.length === 0) return

		this.abortController?.abort()
		this.abortController = new AbortController()

		try {
			const groups = await this.concertService.listWithProximity(
				PREVIEW_ARTIST_IDS,
				'JP',
				'JP-13',
				this.abortController.signal,
			)

			// Build artist map from env-configured names (preview has no followed artists)
			const artistMap = new Map<string, { artist: Artist; hype: Hype }>()
			for (const [id, name] of PREVIEW_ARTIST_NAME_MAP) {
				artistMap.set(id, {
					artist: { id, name, mbid: '' },
					hype: 'watch',
				})
			}

			const allGroups = this.concertService.toDateGroups(groups, artistMap)

			// Cap preview at ~30 concerts to avoid overwhelming the visitor
			const MAX_PREVIEW_CONCERTS = 30
			const capped: DateGroup[] = []
			let total = 0
			const artistsWithData = new Set<string>()

			for (const g of allGroups) {
				const concerts = [...g.home, ...g.nearby, ...g.away]
				for (const c of concerts) {
					artistsWithData.add(c.artistId)
				}
				total += concerts.length
				capped.push(g)
				if (total >= MAX_PREVIEW_CONCERTS) break
			}

			if (artistsWithData.size < PREVIEW_MIN_ARTISTS_WITH_CONCERTS) {
				this.logger.debug('Not enough artists with concerts for preview', {
					found: artistsWithData.size,
				})
				return
			}

			this.dateGroups = capped
		} catch (err) {
			this.logger.warn('Preview data load failed', { error: err })
		}
	}

	public async currentLocaleChanged(newLocale: string): Promise<void> {
		if (!newLocale || newLocale === this.i18n.getLocale()) return
		await changeLocale(this.i18n, newLocale)
	}

	async canLoad(): Promise<NavigationInstruction | boolean> {
		this.logger.debug('Checking if landing page can load')

		await this.authService.ready

		if (this.authService.isAuthenticated) {
			this.logger.info('User is authenticated, redirecting to dashboard')
			return 'dashboard'
		}

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

	/**
	 * Smooth-scrolls the viewport to Screen 2 (the preview section). Honors the
	 * user's `prefers-reduced-motion` setting by jumping instantly instead. No-op
	 * when Screen 2 is not rendered (i.e. `dateGroups` is empty).
	 */
	scrollToPreview(): void {
		const target = this.host.querySelector('.welcome-screen-2')
		if (!target) {
			this.logger.debug('scrollToPreview invoked but preview section absent')
			return
		}

		const prefersReducedMotion =
			typeof window !== 'undefined' &&
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches

		this.logger.debug('Scroll affordance activated', {
			reducedMotion: prefersReducedMotion,
		})

		target.scrollIntoView({
			behavior: prefersReducedMotion ? 'auto' : 'smooth',
			block: 'start',
		})
	}

	async handleGetStarted(): Promise<void> {
		this.logger.info('Get Started tapped, entering onboarding')
		// Reset the onboarding cursor but PRESERVE guest data. A user returning
		// to / after having already followed artists as a guest should resume
		// onboarding with those follows intact, not start from zero. Login is
		// different — see handleLogin for the rationale.
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
		// Discard any anonymous trial state (guest follows, guest home) before
		// starting sign-in. Login is an explicit assertion of "I am a returning
		// user", so leftover guest data must not leak into auth-callback's
		// post-sign-in heuristics — most importantly the guestHome-driven
		// new-signup detection in ensureUserProvisioned, which would otherwise
		// surface PostSignupDialog to an existing user who happened to pick a
		// home during a prior anonymous session.
		this.guest.clearAll()
		try {
			await this.authService.signIn()
		} catch (err) {
			this.logger.error('Failed to start sign-in flow', { error: err })
			this.ea.publish(new Snack(this.i18n.tr('welcome.error.login')))
		}
	}
}
