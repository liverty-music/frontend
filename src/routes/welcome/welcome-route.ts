import { I18N } from '@aurelia/i18n'
import {
	IRouter,
	type IRouteViewModel,
	type NavigationInstruction,
} from '@aurelia/router'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { concertFrom } from '../../adapter/rpc/mapper/concert-mapper'
import { Snack } from '../../components/snack-bar/snack'
import {
	PREVIEW_ARTIST_IDS,
	PREVIEW_MIN_ARTISTS_WITH_CONCERTS,
} from '../../constants/preview-artists'
import type { Concert, DateGroup } from '../../entities/concert'
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

	/** Preview concert data for the read-only dashboard lane on the welcome page. */
	public previewDateGroups: DateGroup[] = []

	public attached(): void {
		void this.loadPreviewConcerts()
	}

	private async loadPreviewConcerts(): Promise<void> {
		const artistsWithData = new Set<string>()
		const byDate = new Map<string, Concert[]>()

		for (const artistId of PREVIEW_ARTIST_IDS) {
			if (artistsWithData.size >= PREVIEW_MIN_ARTISTS_WITH_CONCERTS) break
			try {
				const protos = await this.concertService.listConcerts(artistId)
				if (protos.length === 0) continue

				artistsWithData.add(artistId)
				for (const proto of protos) {
					const ld = proto.localDate?.value
					if (!ld) continue
					const dateKey = `${ld.year}-${String(ld.month).padStart(2, '0')}-${String(ld.day).padStart(2, '0')}`
					const concert = concertFrom(proto, '', 'away', true)
					if (!concert) continue
					const list = byDate.get(dateKey) ?? []
					list.push(concert)
					byDate.set(dateKey, list)
				}
			} catch (err) {
				this.logger.debug('Preview fetch skipped for artist', {
					artistId,
					error: err,
				})
			}
		}

		if (artistsWithData.size < PREVIEW_MIN_ARTISTS_WITH_CONCERTS) {
			this.logger.debug('Not enough artists with concerts for preview', {
				found: artistsWithData.size,
			})
			return
		}

		this.previewDateGroups = Array.from(byDate.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.slice(0, 7)
			.map(([dateKey, concerts]) => {
				const [year, month, day] = dateKey.split('-').map(Number) as [
					number,
					number,
					number,
				]
				const label = new Date(year, month - 1, day).toLocaleDateString(
					'ja-JP',
					{
						month: 'long',
						day: 'numeric',
						weekday: 'short',
					},
				)
				return { dateKey, label, home: [], nearby: concerts, away: [] }
			})
	}

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
