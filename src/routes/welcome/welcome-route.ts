import { I18N } from '@aurelia/i18n'
import {
	IRouter,
	type IRouteViewModel,
	type NavigationInstruction,
} from '@aurelia/router'
import { IEventAggregator, ILogger, INode, observable, resolve } from 'aurelia'
import { Snack } from '../../components/snack-bar/snack'
import {
	getPreviewArtistIds,
	getPreviewArtistNameMap,
	PREVIEW_MIN_ARTISTS_WITH_CONCERTS,
} from '../../constants/preview-artists'
import type { Artist } from '../../entities/artist'
import type { DateGroup } from '../../entities/concert'
import type { Hype } from '../../entities/follow'
import { IAuthService } from '../../services/auth-service'
import { IConcertStore } from '../../services/concert-store'
import { IGuestService } from '../../services/guest-service'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import { IUserService } from '../../services/user-service'
import { changeLocale, SUPPORTED_LANGUAGES } from '../../util/change-locale'

export class WelcomeRoute implements IRouteViewModel {
	private readonly authService = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly guest = resolve(IGuestService)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('WelcomeRoute')
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)
	private readonly concertService = resolve(IConcertStore)
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
		const previewIds = getPreviewArtistIds()
		if (previewIds.length === 0) return

		this.abortController?.abort()
		this.abortController = new AbortController()

		try {
			const groups = await this.concertService.listWithProximity(
				previewIds,
				'JP',
				'JP-13',
				this.abortController.signal,
			)

			// Build artist map from configured names (preview has no followed artists).
			// Preview-only synthetic hype. Intentionally NOT DEFAULT_HYPE — `watch`
			// makes preview concerts render as "unmatched" (faded-poster treatment)
			// per the passion-level hype-lane match rule, which keeps the welcome
			// page softer than a real fan's dashboard. Changing this to DEFAULT_HYPE
			// would shift the visual treatment to "matched" (festival-stage) and
			// alter the welcome page's intended aesthetic.
			const artistMap = new Map<string, { artist: Artist; hype: Hype }>()
			for (const [id, name] of getPreviewArtistNameMap()) {
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
				// resolved counts only the concerts that contribute a real
				// artist to artistsWithData. Counting every concert (incl.
				// those with blank artistId from a failed performer
				// resolution) could exhaust the 30-slot cap on unresolved
				// rows alone, breaking the loop before enough artist-matched
				// concerts are seen and silently suppressing the preview
				// even when valid data exists past the cap boundary.
				let resolved = 0
				for (const c of concerts) {
					if (c.artistId) {
						artistsWithData.add(c.artistId)
						resolved++
					}
				}
				total += resolved
				// Drop the entire group when none of its concerts resolved
				// AND strip blank-artist concerts from partially-resolved
				// groups before pushing. The previous group-level guard
				// alone still leaked individual ghost cards from a mixed
				// group into the unauthenticated preview.
				if (resolved > 0) {
					capped.push({
						...g,
						home: g.home.filter((c) => c.artistId),
						nearby: g.nearby.filter((c) => c.artistId),
						away: g.away.filter((c) => c.artistId),
					})
				}
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
		// Welcome is anonymous-only — canLoad redirects authenticated
		// callers to /dashboard before this code runs, so
		// `authService.isAuthenticated` is guaranteed false here. The
		// `userService.updatePreferredLanguage` branch inside changeLocale
		// is therefore intentional dead code from this call site.
		//
		// We still call the shared changeLocale (rather than inlining the
		// anonymous path) so the welcome page and settings page route
		// every locale change through one validation + persistence policy.
		// The cost is a single DI resolve of IUserService at construction
		// time, which is the right trade-off vs. a second code path that
		// could silently diverge.
		await changeLocale(
			{
				i18n: this.i18n,
				auth: this.authService,
				userService: this.userService,
				guest: this.guest,
			},
			newLocale,
		)
	}

	async canLoad(): Promise<NavigationInstruction | boolean> {
		this.logger.debug('Checking if landing page can load')

		await this.authService.ready

		if (this.authService.isAuthenticated) {
			this.logger.info('User is authenticated, redirecting to dashboard')
			return 'dashboard'
		}

		// Welcome is intentionally reachable during onboarding so users can
		// re-read the value proposition. Merely viewing it must not reset
		// onboarding — onboardingStep only changes when [Get Started] is tapped
		// (see handleGetStarted). Login is reachable from Settings, so Welcome
		// is no longer the only way back to an auth entry.
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
