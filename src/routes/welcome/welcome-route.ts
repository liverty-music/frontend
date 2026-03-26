import { I18N } from '@aurelia/i18n'
import {
	IRouter,
	type IRouteViewModel,
	type NavigationInstruction,
} from '@aurelia/router'
import { IEventAggregator, ILogger, observable, resolve } from 'aurelia'
import type { Artist } from '../../entities/artist'
import type { DateGroup } from '../../entities/concert'
import type { Hype } from '../../entities/follow'
import { Snack } from '../../components/snack-bar/snack'
import {
	PREVIEW_ARTIST_IDS,
	PREVIEW_ARTIST_NAME_MAP,
	PREVIEW_MIN_ARTISTS_WITH_CONCERTS,
} from '../../constants/preview-artists'
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
