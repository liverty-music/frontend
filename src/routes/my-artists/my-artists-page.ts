import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { HypeType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/follow_pb.js'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import type { HypeStop } from '../../components/hype-inline-slider/hype-inline-slider'
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
}

export const HYPE_META: Record<number, { labelKey: string; icon: string }> = {
	[HypeType.WATCH]: { labelKey: 'チェック', icon: '👀' },
	[HypeType.HOME]: { labelKey: '地元', icon: '🔥' },
	[HypeType.NEARBY]: { labelKey: '近くも', icon: '🔥🔥' },
	[HypeType.AWAY]: {
		labelKey: 'どこでも！',
		icon: '🔥🔥🔥',
	},
}

export const HYPE_LEVELS = [
	HypeType.WATCH,
	HypeType.HOME,
	HypeType.NEARBY,
	HypeType.AWAY,
] as const

export type ViewMode = 'list' | 'grid'

export class MyArtistsPage {
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

	// Swipe state
	public swipedArtistId = ''
	public swipeOffset = 0
	private touchStartX = 0
	private touchStartY = 0
	private isSwiping = false
	private swipeTarget: FollowedArtist | null = null

	// Long-press state
	private longPressTimer: ReturnType<typeof setTimeout> | null = null
	private readonly LONG_PRESS_MS = 500

	// Undo state
	private undoArtist: FollowedArtist | null = null
	private undoIndex = -1
	private undoHandle: ToastHandle | null = null

	// Hype level references
	public readonly hypeLevels = HYPE_LEVELS
	public readonly hypeMeta = HYPE_META

	private readonly logger = resolve(ILogger).scopeTo('MyArtistsPage')
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)

	public trHypeLabel(level: number): string {
		const meta = HYPE_META[level]
		return meta?.labelKey ?? ''
	}
	private readonly followService = resolve(IFollowServiceClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly router = resolve(IRouter)
	private readonly ea = resolve(IEventAggregator)
	private abortController: AbortController | null = null

	// Tutorial state
	public pulsingArtistId = ''

	public get isTutorialStep5(): boolean {
		return this.onboarding.currentStep === OnboardingStep.MY_ARTISTS
	}

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get isAuthenticated(): boolean {
		return this.authService.isAuthenticated
	}

	public getArtistColor(id: string): string {
		const artist = this.artists.find((a) => a.id === id)
		return artist?.color ?? ''
	}

	private static readonly HYPE_TYPE_TO_STOP: Record<number, HypeStop> = {
		[HypeType.WATCH]: 'watch',
		[HypeType.HOME]: 'home',
		[HypeType.NEARBY]: 'nearby',
		[HypeType.AWAY]: 'away',
	}

	public hypeStop(artist: FollowedArtist): HypeStop {
		return MyArtistsPage.HYPE_TYPE_TO_STOP[artist.hype] ?? 'watch'
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

		if (this.isTutorialStep5 && this.artists.length > 0) {
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
		this.clearLongPressTimer()
	}

	// --- Swipe-to-unfollow ---

	public onTouchStart(artist: FollowedArtist, e: TouchEvent): void {
		if (this.swipeTarget) return
		this.touchStartX = e.touches[0].clientX
		this.touchStartY = e.touches[0].clientY
		this.isSwiping = false
		this.swipeTarget = artist

		this.longPressTimer = setTimeout(() => {
			this.onLongPress(artist)
		}, this.LONG_PRESS_MS)
	}

	public onTouchMove(e: TouchEvent): void {
		if (!this.swipeTarget) return

		const deltaX = e.touches[0].clientX - this.touchStartX
		const deltaY = e.touches[0].clientY - this.touchStartY

		// Cancel long-press on any movement
		this.clearLongPressTimer()

		// Determine if horizontal swipe (only activate on left swipe)
		if (!this.isSwiping) {
			if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY)) {
				this.isSwiping = true
			} else if (Math.abs(deltaY) > 10) {
				// Vertical scroll — cancel swipe
				this.swipeTarget = null
				return
			} else {
				return
			}
		}

		// Only allow left swipe (negative deltaX)
		this.swipeOffset = Math.min(0, deltaX)
		this.swipedArtistId = this.swipeTarget.id
	}

	public onTouchEnd(): void {
		this.clearLongPressTimer()

		if (!this.swipeTarget || !this.isSwiping) {
			this.resetSwipe()
			return
		}

		// If swiped past threshold, trigger unfollow
		if (this.swipeOffset < -80) {
			this.unfollowArtist(this.swipeTarget)
		}

		this.resetSwipe()
	}

	// --- Long-press unfollow ---

	private onLongPress(artist: FollowedArtist): void {
		this.longPressTimer = null
		this.unfollowArtist(artist)
	}

	private clearLongPressTimer(): void {
		if (this.longPressTimer !== null) {
			clearTimeout(this.longPressTimer)
			this.longPressTimer = null
		}
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

	private resetSwipe(): void {
		this.swipeOffset = 0
		this.swipedArtistId = ''
		this.isSwiping = false
		this.swipeTarget = null
	}

	// --- Hype level inline slider ---

	private static readonly HYPE_STOP_TO_TYPE: Record<HypeStop, HypeType> = {
		watch: HypeType.WATCH,
		home: HypeType.HOME,
		nearby: HypeType.NEARBY,
		away: HypeType.AWAY,
	}

	public onHypeChanged(
		event: CustomEvent<{ artistId: string; level: HypeStop }>,
	): void {
		const { artistId, level } = event.detail
		const artist = this.artists.find((a) => a.id === artistId)
		if (!artist) return

		const hypeType = MyArtistsPage.HYPE_STOP_TO_TYPE[level]
		const prev = artist.hype
		if (prev === hypeType) return

		// During onboarding step 5: visual demo only, no persistence
		if (this.isTutorialStep5) {
			artist.hype = hypeType

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
		artist.hype = hypeType

		// Fire-and-forget RPC with 1 retry
		const client = this.followService.getClient()
		const req = {
			artistId: new ArtistId({ value: artistId }),
			hype: hypeType,
		}
		client
			.setHype(req)
			.then(() => {
				this.logger.info('Hype level updated', { artistId, level })
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
							level,
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
		return HYPE_META[artist.hype]?.icon ?? '\u{1F525}'
	}

	// --- View toggle ---

	public toggleView(): void {
		this.viewMode = this.viewMode === 'list' ? 'grid' : 'list'
	}

	// --- Grid context menu ---

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

	public tileSpan(artist: FollowedArtist): string {
		return artist.hype === HypeType.AWAY ? 'col-span-2 row-span-2' : ''
	}

	// --- Grid long-press touch handler ---

	private gridLongPressTimer: ReturnType<typeof setTimeout> | null = null

	public onGridTouchStart(artist: FollowedArtist): void {
		this.gridLongPressTimer = setTimeout(() => {
			this.gridLongPressTimer = null
			this.onGridLongPress(artist)
		}, this.LONG_PRESS_MS)
	}

	public onGridTouchEnd(): void {
		if (this.gridLongPressTimer !== null) {
			clearTimeout(this.gridLongPressTimer)
			this.gridLongPressTimer = null
		}
	}

	// --- Navigation ---

	public async goToDiscover(): Promise<void> {
		await this.router.load('discover')
	}
}
