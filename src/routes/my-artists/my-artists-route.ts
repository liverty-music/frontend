import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { HypeType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/follow_pb.js'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { artistColor } from '../../components/live-highway/color-generator'
import { Snack, type SnackHandle } from '../../components/snack-bar/snack'
import type { FollowedArtist, Hype } from '../../entities/follow'
import { IAuthService } from '../../services/auth-service'
import { IFollowServiceClient } from '../../services/follow-service-client'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'

export interface MyArtist extends FollowedArtist {
	color: string
}

export const HYPE_TIERS: Record<string, { labelKey: string; icon: string }> = {
	watch: { labelKey: 'チェック', icon: '👀' },
	home: { labelKey: '地元', icon: '🔥' },
	nearby: { labelKey: '近くも', icon: '🔥🔥' },
	away: {
		labelKey: 'どこでも！',
		icon: '🔥🔥🔥',
	},
}

export class MyArtistsRoute {
	public artists: MyArtist[] = []
	public isLoading = true

	// Notification dialog state
	public showNotificationDialog = false
	public showSignupBanner = false
	public notificationDialogShown = false

	// Dismiss state (tracks scroll containers currently dismissing)
	private dismissingIds = new Set<string>()

	// Undo state
	private undoArtist: MyArtist | null = null
	private undoIndex = -1
	private undoHandle: SnackHandle | null = null

	// Hype tier references
	public readonly hypeLevels: Hype[] = ['watch', 'home', 'nearby', 'away']
	public readonly hypeTiers = HYPE_TIERS

	private readonly logger = resolve(ILogger).scopeTo('MyArtistsRoute')
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)

	public trHypeLabel(level: Hype): string {
		const meta = HYPE_TIERS[level]
		return meta?.labelKey ?? ''
	}

	/** Convert entity Hype string to proto HypeType for the slider component. */
	public hypeToNumber(hype: Hype): HypeType {
		switch (hype) {
			case 'watch':
				return HypeType.WATCH
			case 'home':
				return HypeType.HOME
			case 'nearby':
				return HypeType.NEARBY
			case 'away':
				return HypeType.AWAY
		}
	}
	private readonly followService = resolve(IFollowServiceClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly router = resolve(IRouter)
	private readonly ea = resolve(IEventAggregator)
	private abortController: AbortController | null = null

	// Onboarding state
	public pulsingArtistId = ''

	public get isOnboardingStepMyArtists(): boolean {
		return this.onboarding.currentStep === OnboardingStep.MY_ARTISTS
	}

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get isAuthenticated(): boolean {
		return this.authService.isAuthenticated
	}

	public async loading(): Promise<void> {
		this.isLoading = true
		this.abortController = new AbortController()

		try {
			const followed = await this.followService.listFollowed(
				this.abortController.signal,
			)
			this.artists = followed.map((fa) => ({
				...fa,
				color: artistColor(fa.name),
			}))
			this.logger.info('Followed artists loaded', {
				count: this.artists.length,
			})
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				this.logger.error('Failed to load followed artists', { error: err })
			}
		} finally {
			this.isLoading = false
		}

		if (this.isOnboardingStepMyArtists && this.artists.length > 0) {
			this.onboarding.activateSpotlight(
				'[data-hype-header]',
				'絶対に見逃したくないアーティストの熱量を上げておこう',
			)
		}
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
		this.undoHandle?.dismiss()
	}

	// --- Scroll-snap dismiss ---

	public checkDismiss(event: Event, artist: MyArtist): void {
		if (this.dismissingIds.has(artist.id)) return

		const el = event.target as HTMLElement
		if (el.scrollLeft > (el.scrollWidth - el.offsetWidth) * 0.5) {
			this.dismissingIds.add(artist.id)
			this.executeDismiss(artist)
		}
	}

	private executeDismiss(artist: MyArtist): void {
		if (!document.startViewTransition) {
			this.unfollowArtist(artist)
			this.dismissingIds.delete(artist.id)
			return
		}

		const transition = document.startViewTransition(() => {
			this.unfollowArtist(artist)
			this.dismissingIds.delete(artist.id)
			return Promise.resolve()
		})
		transition.finished.catch(() => {
			this.dismissingIds.delete(artist.id)
		})
	}

	// --- Unfollow with undo ---

	private unfollowArtist(artist: MyArtist): void {
		// Block unfollow during onboarding
		if (this.isOnboarding) return

		// Dismiss any previous undo toast (commits that unfollow)
		this.undoHandle?.dismiss()

		const index = this.artists.findIndex((a) => a.id === artist.id)
		if (index === -1) return

		// Optimistic removal
		this.artists.splice(index, 1)
		this.undoArtist = artist
		this.undoIndex = index

		this.logger.info('Artist unfollowed (pending)', { name: artist.name })

		const toast = new Snack(
			this.i18n.tr('myArtists.unfollowed', { name: artist.name }),
			'info',
			{
				duration: 5000,
				action: {
					label: this.i18n.tr('myArtists.undo'),
					callback: () => this.undo(),
				},
				onDismiss: () => {
					if (this.undoArtist) {
						this.commitUnfollow(this.undoArtist, this.undoIndex)
						this.undoArtist = null
						this.undoHandle = null
					}
				},
			},
		)
		this.ea.publish(toast)
		this.undoHandle = toast.handle
	}

	private undo(): void {
		if (!this.undoArtist) return

		// Re-insert at original position
		const insertAt = Math.min(this.undoIndex, this.artists.length)
		this.artists.splice(insertAt, 0, this.undoArtist)

		this.logger.info('Undo unfollow', { name: this.undoArtist.name })

		this.undoArtist = null
		this.undoHandle = null
	}

	private commitUnfollow(artist: MyArtist, originalIndex: number): void {
		// Fire-and-forget RPC with 1 retry
		const client = this.followService.getClient()
		const req = { artistId: new ArtistId({ value: artist.id }) }
		client
			.unfollow(req)
			.then(() => {
				this.logger.info('Unfollow committed', { name: artist.name })
			})
			.catch((firstErr) => {
				this.logger.warn('Unfollow failed, retrying', {
					name: artist.name,
					error: firstErr,
				})
				client
					.unfollow(req)
					.then(() => {
						this.logger.info('Unfollow committed on retry', {
							name: artist.name,
						})
					})
					.catch((retryErr) => {
						this.logger.error('Failed to unfollow artist after retry', {
							name: artist.name,
							error: retryErr,
						})
						// Revert optimistic removal
						const insertAt = Math.min(originalIndex, this.artists.length)
						this.artists.splice(insertAt, 0, artist)
						this.ea.publish(
							new Snack(
								this.i18n.tr('myArtists.failedUnfollow', { name: artist.name }),
							),
						)
					})
			})
	}

	// --- Hype level inline slider ---

	public onHypeChanged(
		event: CustomEvent<{ artistId: string; hype: HypeType }>,
	): void {
		const { artistId, hype: hypeType } = event.detail
		const hype = hypeTypeToHype(hypeType)
		const artist = this.artists.find((a) => a.id === artistId)
		if (!artist) return

		const prev = artist.hype
		if (prev === hype) return

		// During onboarding step 5: visual demo only, no persistence
		if (this.isOnboardingStepMyArtists) {
			artist.hype = hype

			// Immediate pulse feedback
			this.pulsingArtistId = artistId
			setTimeout(() => {
				this.pulsingArtistId = ''
			}, 300)

			// Complete onboarding and return to welcome page
			this.onboarding.deactivateSpotlight()
			this.onboarding.setStep(OnboardingStep.COMPLETED)
			void this.router.load('')
			return
		}

		// Block hype level changes during other onboarding steps
		if (this.isOnboarding) return

		// Optimistic update
		artist.hype = hype

		// Fire-and-forget RPC with 1 retry
		const client = this.followService.getClient()
		const req = {
			artistId: new ArtistId({ value: artistId }),
			hype: hypeType,
		}
		client
			.setHype(req)
			.then(() => {
				this.logger.info('Hype level updated', { artistId, hype })
			})
			.catch((firstErr) => {
				this.logger.warn('Hype level update failed, retrying', {
					artistId,
					error: firstErr,
				})
				client
					.setHype(req)
					.then(() => {
						this.logger.info('Hype level updated on retry', {
							artistId,
							hype,
						})
					})
					.catch((retryErr) => {
						this.logger.error('Failed to update hype level after retry', {
							error: retryErr,
						})
						const a = this.artists.find((x) => x.id === artistId)
						if (a) a.hype = prev
						this.ea.publish(new Snack(this.i18n.tr('myArtists.failedHype')))
					})
			})
	}

	public onHypeSignupPrompt(_event: CustomEvent): void {
		if (!this.notificationDialogShown) {
			this.showNotificationDialog = true
		}
	}

	public onSignupRequested(): void {
		this.authService.signUp()
	}

	public onDialogDismissed(): void {
		this.showNotificationDialog = false
		this.showSignupBanner = true
		this.notificationDialogShown = true
	}

	public hypeIcon(artist: MyArtist): string {
		return HYPE_TIERS[artist.hype]?.icon ?? '\u{1F525}'
	}

	// --- Navigation ---

	public async goToDiscovery(): Promise<void> {
		await this.router.load('discovery')
	}
}

function hypeTypeToHype(hype: HypeType): Hype {
	switch (hype) {
		case HypeType.WATCH:
			return 'watch'
		case HypeType.HOME:
			return 'home'
		case HypeType.NEARBY:
			return 'nearby'
		case HypeType.AWAY:
			return 'away'
		default:
			return 'watch'
	}
}
