import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { HypeType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/follow_pb.js'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { artistColor } from '../../components/live-highway/color-generator'
import {
	Toast,
	type ToastHandle,
} from '../../components/toast-notification/toast'
import { IAuthService } from '../../services/auth-service'
import { IFollowServiceClient } from '../../services/follow-service-client'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'

export interface FollowedArtist {
	id: string
	name: string
	color: string
	hype: HypeType
	thumbUrl?: string
	logoUrl?: string
}

export const HYPE_TIERS: Record<number, { labelKey: string; icon: string }> = {
	[HypeType.WATCH]: { labelKey: 'チェック', icon: '👀' },
	[HypeType.HOME]: { labelKey: '地元', icon: '🔥' },
	[HypeType.NEARBY]: { labelKey: '近くも', icon: '🔥🔥' },
	[HypeType.AWAY]: {
		labelKey: 'どこでも！',
		icon: '🔥🔥🔥',
	},
}

export type ViewMode = 'list' | 'grid'

export class MyArtistsRoute {
	public artists: FollowedArtist[] = []
	public isLoading = true

	// View toggle
	public viewMode: ViewMode = 'list'

	// Grid context menu state
	public contextMenuArtist: FollowedArtist | null = null
	private contextMenuDialog!: HTMLDialogElement

	// Notification dialog state
	public showNotificationDialog = false
	public showSignupBanner = false
	public notificationDialogShown = false

	// Dismiss state (tracks scroll containers currently dismissing)
	private dismissingIds = new Set<string>()

	// Undo state
	private undoArtist: FollowedArtist | null = null
	private undoIndex = -1
	private undoHandle: ToastHandle | null = null

	// Hype tier references
	public readonly hypeLevels = [
		HypeType.WATCH,
		HypeType.HOME,
		HypeType.NEARBY,
		HypeType.AWAY,
	]
	public readonly hypeTiers = HYPE_TIERS

	private readonly logger = resolve(ILogger).scopeTo('MyArtistsRoute')
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)

	public trHypeLabel(level: number): string {
		const meta = HYPE_TIERS[level]
		return meta?.labelKey ?? ''
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
				id: fa.id,
				name: fa.name,
				color: artistColor(fa.name),
				hype: fa.hype,
				thumbUrl: fa.thumbUrl,
				logoUrl: fa.logoUrl,
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

	public checkDismiss(event: Event, artist: FollowedArtist): void {
		if (this.dismissingIds.has(artist.id)) return

		const el = event.target as HTMLElement
		if (el.scrollLeft > (el.scrollWidth - el.offsetWidth) * 0.5) {
			this.dismissingIds.add(artist.id)
			this.executeDismiss(artist)
		}
	}

	private executeDismiss(artist: FollowedArtist): void {
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

	private unfollowArtist(artist: FollowedArtist): void {
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

		const toast = new Toast(
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

	private commitUnfollow(artist: FollowedArtist, originalIndex: number): void {
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
							new Toast(
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
		const { artistId, hype } = event.detail
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
			hype,
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
						this.ea.publish(new Toast(this.i18n.tr('myArtists.failedHype')))
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

	public hypeIcon(artist: FollowedArtist): string {
		return HYPE_TIERS[artist.hype]?.icon ?? '\u{1F525}'
	}

	// --- View toggle ---

	public toggleView(): void {
		this.viewMode = this.viewMode === 'list' ? 'grid' : 'list'
	}

	// --- Grid context menu ---

	private static readonly GRID_LONG_PRESS_MS = 500

	public onGridLongPress(artist: FollowedArtist): void {
		this.contextMenuArtist = artist
		this.contextMenuDialog.showModal()
	}

	public closeContextMenu(): void {
		this.contextMenuArtist = null
		this.contextMenuDialog.close()
	}

	public onContextMenuDialogClick(e: Event): void {
		if (e.target === this.contextMenuDialog) {
			this.closeContextMenu()
		}
	}

	public contextMenuSetLevel(level: HypeType): void {
		if (!this.contextMenuArtist) return
		const artist = this.contextMenuArtist
		this.closeContextMenu()

		// Block during onboarding (no backend RPC available)
		if (this.isOnboarding) return

		const prev = artist.hype
		if (prev === level) return

		artist.hype = level
		const client = this.followService.getClient()
		const req = {
			artistId: new ArtistId({ value: artist.id }),
			hype: level,
		}
		client.setHype(req).catch((firstErr) => {
			this.logger.warn('Hype level update failed, retrying', {
				error: firstErr,
			})
			client.setHype(req).catch((retryErr) => {
				this.logger.error('Failed to update hype level after retry', {
					error: retryErr,
				})
				artist.hype = prev
				this.ea.publish(new Toast(this.i18n.tr('myArtists.failedHype')))
			})
		})
	}

	public contextMenuUnfollow(): void {
		if (!this.contextMenuArtist) return
		const artist = this.contextMenuArtist
		this.closeContextMenu()
		this.unfollowArtist(artist)
	}

	public onThumbError(artist: FollowedArtist): void {
		artist.thumbUrl = undefined
	}

	public tileSpan(artist: FollowedArtist): string {
		return artist.hype === HypeType.AWAY ? 'col-span-2 row-span-2' : ''
	}

	// --- Grid long-press touch handler ---

	private gridLongPressTimer: ReturnType<typeof setTimeout> | null = null

	public onGridTouchStart(artist: FollowedArtist): void {
		this.gridLongPressTimer = setTimeout(() => {
			this.gridLongPressTimer = null
			this.onGridLongPress(artist)
		}, MyArtistsRoute.GRID_LONG_PRESS_MS)
	}

	public onGridTouchEnd(): void {
		if (this.gridLongPressTimer !== null) {
			clearTimeout(this.gridLongPressTimer)
			this.gridLongPressTimer = null
		}
	}

	// --- Navigation ---

	public async goToDiscovery(): Promise<void> {
		await this.router.load('discovery')
	}
}
