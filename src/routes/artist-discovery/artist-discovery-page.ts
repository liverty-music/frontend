import { IRouter } from '@aurelia/router'
import { ILogger, resolve, shadowCSS, useShadowDOM } from 'aurelia'
import type { DnaOrbCanvas } from '../../components/dna-orb/dna-orb-canvas'
import { IToastService } from '../../components/toast-notification/toast-notification'
import {
	type ArtistBubble,
	IArtistDiscoveryService,
} from '../../services/artist-discovery-service'
import css from './artist-discovery-page.css?raw'

@useShadowDOM()
export class ArtistDiscoveryPage {
	static dependencies = [shadowCSS(css)]

	private readonly discoveryService = resolve(IArtistDiscoveryService)
	private readonly toastService = resolve(IToastService)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('ArtistDiscoveryPage')

	public dnaOrbCanvas!: DnaOrbCanvas

	public showGuidance = true
	public guidanceHiding = false
	private guidanceTimer: number | null = null

	public get followedCount(): number {
		return this.discoveryService.followedArtists.length
	}

	public get showCompleteButton(): boolean {
		return this.followedCount > 0
	}

	public loadFailed = false

	public async loading(): Promise<void> {
		this.logger.info('Loading artist discovery page')
		try {
			await this.discoveryService.loadInitialArtists()
		} catch (err) {
			this.logger.error('Failed to load initial artists', { error: err })
			this.loadFailed = true
			this.toastService.show(
				'Failed to load artists. Tap retry to try again.',
				'error',
			)
		}
	}

	public async retryLoad(): Promise<void> {
		this.loadFailed = false
		try {
			await this.discoveryService.loadInitialArtists()
		} catch (err) {
			this.logger.error('Retry failed to load initial artists', { error: err })
			this.loadFailed = true
			this.toastService.show(
				'Still unable to load artists. Please try again later.',
				'error',
			)
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
			await this.discoveryService.followArtist(artist)
		} catch (err) {
			this.logger.error('Failed to follow artist', {
				artist: artist.name,
				error: err,
			})
			this.toastService.show(
				`Failed to follow ${artist.name}. Please try again.`,
				'error',
			)
			return
		}

		try {
			const hasEvents = await this.discoveryService.checkLiveEvents(artist.name)
			if (hasEvents) {
				this.toastService.show(`${artist.name} has upcoming live events!`)
			}
		} catch (err) {
			this.logger.warn('Failed to check live events', err)
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
			`Couldn't find similar artists for ${artistName}`,
			'warning',
		)
	}

	public async onViewSchedule(): Promise<void> {
		this.logger.info('Navigating to live schedule', {
			followedCount: this.followedCount,
		})
		await this.router.load('/')
	}
}
