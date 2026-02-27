import { IRouter } from '@aurelia/router'
import { I18N } from '@aurelia/i18n'
import { ILogger, resolve, shadowCSS, useShadowDOM } from 'aurelia'
import type { DnaOrbCanvas } from '../../components/dna-orb/dna-orb-canvas'
import { IToastService } from '../../components/toast-notification/toast-notification'
import {
	type ArtistBubble,
	IArtistDiscoveryService,
} from '../../services/artist-discovery-service'
import { IArtistServiceClient } from '../../services/artist-service-client'
import { ILocalArtistClient } from '../../services/local-artist-client'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import css from './artist-discovery-page.css?raw'

const TUTORIAL_FOLLOW_TARGET = 3

@useShadowDOM()
export class ArtistDiscoveryPage {
	static dependencies = [shadowCSS(css)]

	private readonly discoveryService = resolve(IArtistDiscoveryService)
	private readonly artistService = resolve(IArtistServiceClient)
	private readonly localClient = resolve(ILocalArtistClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly toastService = resolve(IToastService)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('ArtistDiscoveryPage')
	public readonly i18n = resolve(I18N)

	public dnaOrbCanvas!: DnaOrbCanvas

	public showGuidance = true
	public guidanceHiding = false
	private guidanceTimer: number | null = null

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get followedCount(): number {
		if (this.isOnboarding) {
			return this.localClient.followedCount
		}
		return this.discoveryService.followedArtists.length
	}

	public get showCompleteButton(): boolean {
		if (this.isOnboarding) {
			return this.followedCount >= TUTORIAL_FOLLOW_TARGET
		}
		return this.followedCount > 0
	}

	public get progressText(): string {
		return `${Math.min(this.followedCount, TUTORIAL_FOLLOW_TARGET)}/${TUTORIAL_FOLLOW_TARGET}`
	}

	public get progressPercent(): number {
		return Math.min((this.followedCount / TUTORIAL_FOLLOW_TARGET) * 100, 100)
	}

	public loadFailed = false

	public async loading(): Promise<void> {
		this.logger.info('Loading artist discovery page')
		try {
			await this.discoveryService.loadInitialArtists()
		} catch (err) {
			this.logger.error('Failed to load initial artists', { error: err })
			this.loadFailed = true
			this.toastService.show(this.i18n.tr('discovery.loadFailed'), 'error')
		}
	}

	public async retryLoad(): Promise<void> {
		this.loadFailed = false
		try {
			await this.discoveryService.loadInitialArtists()
		} catch (err) {
			this.logger.error('Retry failed to load initial artists', { error: err })
			this.loadFailed = true
			this.toastService.show(this.i18n.tr('discovery.retryFailed'), 'error')
		}
	}

	public attached(): void {
		this.guidanceTimer = window.setTimeout(() => {
			this.dismissGuidance()
		}, 5000)
	}

	public detaching(): void {
		if (this.guidanceTimer !== null) {
			clearTimeout(this.guidanceTimer)
			this.guidanceTimer = null
		}
	}

	private dismissGuidance(): void {
		if (!this.showGuidance || this.guidanceHiding) return
		this.guidanceHiding = true
		window.setTimeout(() => {
			this.showGuidance = false
			this.guidanceHiding = false
		}, 400)
	}

	public async onArtistSelected(
		event: CustomEvent<{ artist: ArtistBubble }>,
	): Promise<void> {
		const artist = event.detail.artist
		this.logger.info('Artist selected', { artist: artist.name })

		this.dismissGuidance()

		try {
			// ArtistServiceClient.follow() handles onboarding vs authenticated transparently
			await this.artistService.follow(artist.id, artist.name)
			// Update discovery service UI state (remove from available, add to followed)
			this.discoveryService.markFollowed(artist)
		} catch (err) {
			this.logger.error('Failed to follow artist', {
				artist: artist.name,
				error: err,
			})
			this.toastService.show(
				this.i18n.tr('discovery.followFailed', { name: artist.name }),
				'error',
			)
			return
		}

		if (!this.isOnboarding) {
			try {
				const hasEvents = await this.discoveryService.checkLiveEvents(
					artist.name,
				)
				if (hasEvents) {
					this.toastService.show(
						this.i18n.tr('discovery.hasUpcomingEvents', { name: artist.name }),
					)
				}
			} catch (err) {
				this.logger.warn('Failed to check live events', err)
			}
		}
	}

	public onSimilarArtistsUnavailable(
		event: CustomEvent<{ artistName: string }>,
	): void {
		const artistName = event.detail.artistName
		this.logger.info('No similar artists found', { artistName })
	}

	public onSimilarArtistsError(
		event: CustomEvent<{ artistName: string; error: unknown }>,
	): void {
		const artistName = event.detail.artistName
		this.logger.warn('Error loading similar artists', {
			artistName,
			error: event.detail.error,
		})
		this.toastService.show(
			this.i18n.tr('discovery.similarArtistsError', { name: artistName }),
			'warning',
		)
	}

	public async onViewSchedule(): Promise<void> {
		if (this.isOnboarding) {
			this.logger.info('Tutorial: advancing to loading step', {
				followedCount: this.followedCount,
			})
			this.onboarding.setStep(OnboardingStep.LOADING)
			await this.router.load('onboarding/loading')
			return
		}

		this.logger.info('Navigating to live schedule', {
			followedCount: this.followedCount,
		})
		await this.router.load('/')
	}
}
