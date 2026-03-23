import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { artistColor } from '../../adapter/view/artist-color'
import { HYPE_TIERS } from '../../adapter/view/hype-display'
import { Snack, type SnackHandle } from '../../components/snack-bar/snack'
import type { FollowedArtist, Hype } from '../../entities/follow'
import { IAuthService } from '../../services/auth-service'
import { IFollowServiceClient } from '../../services/follow-service-client'
import { IGuestService } from '../../services/guest-service'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'

export interface MyArtist extends FollowedArtist {
	color: string
}

export class MyArtistsRoute {
	public artists: MyArtist[] = []
	public isLoading = true

	// Notification dialog state
	public showNotificationDialog = false
	public showSignupBanner = false
	public notificationDialogShown = false

	// Hype state tracking for revert
	private prevHypes = new Map<string, Hype>()

	// Undo state
	private undoArtist: MyArtist | null = null
	private undoIndex = -1
	private undoHandle: SnackHandle | null = null

	// Hype tier references
	public readonly hypeLevels: Hype[] = ['watch', 'home', 'nearby', 'away']

	private readonly logger = resolve(ILogger).scopeTo('MyArtistsRoute')
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)

	private readonly followService = resolve(IFollowServiceClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly router = resolve(IRouter)
	private readonly ea = resolve(IEventAggregator)
	private readonly guest = resolve(IGuestService)
	private abortController: AbortController | null = null

	public get isOnboardingStepMyArtists(): boolean {
		return this.onboarding.currentStep === OnboardingStep.MY_ARTISTS
	}

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get isAuthenticated(): boolean {
		return this.authService.isAuthenticated
	}

	/** Get the artist ID string for template bindings. */
	public artistId(myArtist: MyArtist): string {
		return myArtist.artist.id
	}

	/** Get the artist name string for template bindings. */
	public artistName(myArtist: MyArtist): string {
		return myArtist.artist.name
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
				color: artistColor(fa.artist.name),
			}))
			this.prevHypes = new Map(this.artists.map((a) => [a.artist.id, a.hype]))
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

		if (!this.isAuthenticated && this.onboarding.isCompleted) {
			this.showSignupBanner = true
		}

		if (this.isOnboardingStepMyArtists && this.artists.length > 0) {
			this.onboarding.activateSpotlight(
				'[data-artist-rows]',
				this.i18n.tr('myArtists.spotlight.setHypeMessage'),
				() => this.onboarding.deactivateSpotlight(),
			)
		}
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
		this.undoHandle?.dismiss()
	}

	// --- Unfollow with undo ---

	public unfollowArtist(artist: MyArtist): void {
		// Block unfollow during onboarding
		if (this.isOnboarding) return

		// Dismiss any previous undo toast (commits that unfollow)
		this.undoHandle?.dismiss()

		const artistId = this.artistId(artist)
		const artistName = this.artistName(artist)
		const index = this.artists.findIndex((a) => a.artist.id === artistId)
		if (index === -1) return

		// Optimistic removal (with View Transition if available)
		const doRemove = () => {
			this.artists.splice(index, 1)
			this.undoArtist = artist
			this.undoIndex = index
		}

		if (document.startViewTransition) {
			document.startViewTransition(doRemove)
		} else {
			doRemove()
		}

		this.logger.info('Artist unfollowed (pending)', { name: artistName })

		const toast = new Snack(
			this.i18n.tr('myArtists.unfollowed', { name: artistName }),
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

		this.logger.info('Undo unfollow', {
			name: this.artistName(this.undoArtist),
		})

		this.undoArtist = null
		this.undoHandle = null
	}

	private commitUnfollow(artist: MyArtist, originalIndex: number): void {
		const artistId = this.artistId(artist)
		const artistName = this.artistName(artist)

		if (!this.isAuthenticated) {
			this.guest.unfollow(artistId)
			this.logger.info('Unfollow committed (guest service)', {
				name: artistName,
			})
			return
		}

		// Fire-and-forget RPC with 1 retry
		this.followService
			.unfollow(artistId)
			.then(() => {
				this.logger.info('Unfollow committed', { name: artistName })
			})
			.catch((firstErr) => {
				this.logger.warn('Unfollow failed, retrying', {
					name: artistName,
					error: firstErr,
				})
				this.followService
					.unfollow(artistId)
					.then(() => {
						this.logger.info('Unfollow committed on retry', {
							name: artistName,
						})
					})
					.catch((retryErr) => {
						this.logger.error('Failed to unfollow artist after retry', {
							name: artistName,
							error: retryErr,
						})
						// Revert optimistic removal
						const insertAt = Math.min(originalIndex, this.artists.length)
						this.artists.splice(insertAt, 0, artist)
						this.ea.publish(
							new Snack(
								this.i18n.tr('myArtists.failedUnfollow', {
									name: artistName,
								}),
							),
						)
					})
			})
	}

	// --- Hype level change (native `change` event from radio) ---

	public onHypeInput(artist: MyArtist): void {
		const artistId = artist.artist.id
		const prev = this.prevHypes.get(artistId) ?? 'watch'
		if (prev === artist.hype) return

		// Onboarding step 5: revert hype, complete onboarding, stay on page
		// Fall through to unauthenticated check so the notification dialog opens immediately
		if (this.isOnboardingStepMyArtists) {
			artist.hype = prev
			this.onboarding.deactivateSpotlight()
			this.onboarding.setStep(OnboardingStep.COMPLETED)
			if (!this.isAuthenticated) {
				if (!this.notificationDialogShown) {
					this.showNotificationDialog = true
				}
			}
			return
		}

		// Block during other onboarding steps
		if (this.isOnboarding) {
			artist.hype = prev
			return
		}

		// Unauthenticated: revert and show signup dialog
		if (!this.isAuthenticated) {
			artist.hype = prev
			if (!this.notificationDialogShown) {
				this.showNotificationDialog = true
			}
			return
		}

		// Authenticated: accept and persist
		const hype = artist.hype
		this.prevHypes.set(artistId, hype)

		this.followService
			.setHype(artistId, hype)
			.then(() => {
				this.logger.info('Hype level updated', { artistId, hype })
			})
			.catch((firstErr) => {
				this.logger.warn('Hype level update failed, retrying', {
					artistId,
					error: firstErr,
				})
				this.followService
					.setHype(artistId, hype)
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
						artist.hype = prev
						this.prevHypes.set(artistId, prev)
						this.ea.publish(new Snack(this.i18n.tr('myArtists.failedHype')))
					})
			})
	}

	public onSignupRequested(): void {
		this.authService.signUp()
	}

	public onDialogDismissed(): void {
		this.showNotificationDialog = false
		this.showSignupBanner = true
		this.notificationDialogShown = true
	}

	public onBannerDismissed(): void {
		this.showSignupBanner = false
	}

	public hypeIcon(artist: MyArtist): string {
		return HYPE_TIERS[artist.hype]?.icon ?? '\u{1F525}'
	}

	// --- Navigation ---

	public async goToDiscovery(): Promise<void> {
		await this.router.load('discovery')
	}
}
