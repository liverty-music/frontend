import { IRouter } from '@aurelia/router'
import { ILogger, resolve, shadowCSS, useShadowDOM } from 'aurelia'
import type { DnaOrbCanvas } from '../../components/dna-orb/dna-orb-canvas'
import { IToastService } from '../../components/toast-notification/toast-notification'
import {
	type ArtistBubble,
	IArtistDiscoveryService,
} from '../../services/artist-discovery-service'

@useShadowDOM()
export class ArtistDiscoveryPage {
	static dependencies = [
		shadowCSS(`
			.container {
				position: relative;
				width: 100%;
				height: 100vh;
				overflow: hidden;
				background: linear-gradient(to bottom, rgb(3, 7, 18), rgb(49, 46, 129), rgb(3, 7, 18));
			}

			.sr-only {
				position: absolute;
				width: 1px;
				height: 1px;
				padding: 0;
				margin: -1px;
				overflow: hidden;
				clip: rect(0, 0, 0, 0);
				white-space: nowrap;
				border-width: 0;
			}

			.complete-button-wrapper {
				position: absolute;
				bottom: 2rem;
				left: 50%;
				transform: translateX(-50%);
				z-index: 20;
			}

			.complete-button {
				padding: 0.75rem 1.5rem;
				background-color: rgb(79, 70, 229);
				color: white;
				font-weight: 600;
				border-radius: 9999px;
				box-shadow: 0 10px 15px -3px rgba(79, 70, 229, 0.3);
				transition: all 300ms;
			}

			.complete-button:hover {
				background-color: rgb(99, 102, 241);
				transform: scale(1.05);
			}
		`),
	]
	private readonly discoveryService = resolve(IArtistDiscoveryService)
	private readonly toastService = resolve(IToastService)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('ArtistDiscoveryPage')

	public dnaOrbCanvas!: DnaOrbCanvas

	public get followedCount(): number {
		return this.discoveryService.followedArtists.length
	}

	public get showCompleteButton(): boolean {
		return this.followedCount > 0
	}

	public async loading(): Promise<void> {
		this.logger.info('Loading artist discovery page')
		await this.discoveryService.loadInitialArtists()
	}

	public async onArtistSelected(
		event: CustomEvent<{ artist: ArtistBubble }>,
	): Promise<void> {
		const artist = event.detail.artist
		this.logger.info('Artist selected', { artist: artist.name })
		await this.discoveryService.followArtist(artist)

		// Check for live events and show toast if available
		try {
			const hasEvents =
				await this.discoveryService.checkLiveEvents(artist.name)
			if (hasEvents) {
				this.toastService.show(
					`🎫 ${artist.name} has upcoming live events!`,
				)
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
		// Optional: Show subtle feedback that no similar artists were found
		// For now, we'll just log it - the user still got their artist followed
	}

	public onSimilarArtistsError(
		event: CustomEvent<{ artistName: string; error: unknown }>,
	): void {
		const artistName = event.detail.artistName
		this.logger.warn('Error loading similar artists', {
			artistName,
			error: event.detail.error,
		})
		// Show a subtle toast to inform the user
		this.toastService.show(
			`Couldn't find similar artists for ${artistName}`,
		)
	}

	public async onViewSchedule(): Promise<void> {
		this.logger.info('Navigating to live schedule', {
			followedCount: this.followedCount,
		})
		localStorage.setItem('liverty:onboarding_complete', 'true')
		await this.router.load('/')
	}
}
