import { IRouter } from '@aurelia/router'
import {
	ArtistId,
	PassionLevel,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ILogger, resolve } from 'aurelia'
import { artistColor } from '../../components/live-highway/color-generator'
import { IToastService } from '../../components/toast-notification/toast-notification'
import { IArtistServiceClient } from '../../services/artist-service-client'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'

export interface FollowedArtist {
	id: string
	name: string
	color: string
	passionLevel: PassionLevel
}

export const PASSION_LEVEL_META: Record<
	number,
	{ label: string; icon: string }
> = {
	[PassionLevel.MUST_GO]: { label: 'Must Go', icon: '🔥🔥' },
	[PassionLevel.LOCAL_ONLY]: { label: 'Local Only', icon: '🔥' },
	[PassionLevel.KEEP_AN_EYE]: { label: 'Keep an Eye', icon: '👀' },
}

const UNDO_TIMEOUT_MS = 5000

export const PASSION_LEVELS = [
	PassionLevel.MUST_GO,
	PassionLevel.LOCAL_ONLY,
	PassionLevel.KEEP_AN_EYE,
] as const

export type ViewMode = 'list' | 'grid'

export class MyArtistsPage {
	public artists: FollowedArtist[] = []
	public isLoading = true

	// View toggle
	public viewMode: ViewMode = 'list'

	// Grid context menu state
	public contextMenuArtist: FollowedArtist | null = null

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
	public undoArtist: FollowedArtist | null = null
	public undoVisible = false
	private undoTimer: ReturnType<typeof setTimeout> | null = null
	private undoIndex = -1

	// Passion level selector state
	public selectorArtist: FollowedArtist | null = null
	public readonly passionLevels = PASSION_LEVELS
	public readonly passionLevelMeta = PASSION_LEVEL_META

	private readonly logger = resolve(ILogger).scopeTo('MyArtistsPage')
	private readonly artistService = resolve(IArtistServiceClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly router = resolve(IRouter)
	private readonly toast = resolve(IToastService)
	private abortController: AbortController | null = null

	// Tutorial state
	public showPassionExplanation = false

	public get isTutorialStep5(): boolean {
		return this.onboarding.currentStep === OnboardingStep.MY_ARTISTS
	}

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public async loading(): Promise<void> {
		this.isLoading = true
		this.abortController = new AbortController()

		try {
			const followed = await this.artistService.listFollowed(
				this.abortController.signal,
			)
			this.artists = followed.map((fa) => ({
				id: fa.id,
				name: fa.name,
				color: artistColor(fa.name),
				passionLevel: fa.passionLevel,
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
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
		this.commitPendingUnfollow()
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

		// Clear any previous undo (commits it)
		this.commitPendingUnfollow()

		const index = this.artists.findIndex((a) => a.id === artist.id)
		if (index === -1) return

		// Optimistic removal
		this.artists.splice(index, 1)
		this.undoArtist = artist
		this.undoIndex = index
		this.undoVisible = true

		this.logger.info('Artist unfollowed (pending)', { name: artist.name })

		// Start undo timer
		this.undoTimer = setTimeout(() => {
			this.commitPendingUnfollow()
		}, UNDO_TIMEOUT_MS)
	}

	public undo(): void {
		if (!this.undoArtist) return

		this.clearUndoTimer()

		// Re-insert at original position
		const insertAt = Math.min(this.undoIndex, this.artists.length)
		this.artists.splice(insertAt, 0, this.undoArtist)

		this.logger.info('Undo unfollow', { name: this.undoArtist.name })

		this.undoArtist = null
		this.undoVisible = false
	}

	private commitPendingUnfollow(): void {
		if (!this.undoArtist) return

		this.clearUndoTimer()
		const artist = this.undoArtist
		const originalIndex = this.undoIndex
		this.undoArtist = null
		this.undoVisible = false

		// Fire-and-forget RPC with 1 retry
		const client = this.artistService.getClient()
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
						this.toast.show(`Failed to unfollow ${artist.name}`)
					})
			})
	}

	private clearUndoTimer(): void {
		if (this.undoTimer !== null) {
			clearTimeout(this.undoTimer)
			this.undoTimer = null
		}
	}

	private resetSwipe(): void {
		this.swipeOffset = 0
		this.swipedArtistId = ''
		this.isSwiping = false
		this.swipeTarget = null
	}

	// --- Passion level selector ---

	public openPassionSelector(artist: FollowedArtist): void {
		this.selectorArtist = artist
	}

	public closePassionSelector(): void {
		this.selectorArtist = null
	}

	public selectPassionLevel(level: PassionLevel): void {
		if (!this.selectorArtist) return

		const prev = this.selectorArtist.passionLevel
		if (prev === level) {
			this.closePassionSelector()
			return
		}

		// During onboarding step 5: visual demo only, no persistence
		if (this.isTutorialStep5) {
			this.selectorArtist.passionLevel = level
			this.closePassionSelector()

			// Show notification explanation, then advance to Step 6
			this.showPassionExplanation = true
			setTimeout(() => {
				this.showPassionExplanation = false
				this.onboarding.setStep(OnboardingStep.SIGNUP)
			}, 3000)
			return
		}

		// Block passion level changes during other onboarding steps
		if (this.isOnboarding) {
			this.closePassionSelector()
			return
		}

		// Optimistic update
		this.selectorArtist.passionLevel = level
		const artistId = this.selectorArtist.id
		this.closePassionSelector()

		// Fire-and-forget RPC with 1 retry
		const client = this.artistService.getClient()
		const req = {
			artistId: new ArtistId({ value: artistId }),
			passionLevel: level,
		}
		client
			.setPassionLevel(req)
			.then(() => {
				this.logger.info('Passion level updated', { artistId, level })
			})
			.catch((firstErr) => {
				this.logger.warn('Passion level update failed, retrying', {
					artistId,
					error: firstErr,
				})
				client
					.setPassionLevel(req)
					.then(() => {
						this.logger.info('Passion level updated on retry', {
							artistId,
							level,
						})
					})
					.catch((retryErr) => {
						this.logger.error('Failed to update passion level after retry', {
							error: retryErr,
						})
						const artist = this.artists.find((a) => a.id === artistId)
						if (artist) artist.passionLevel = prev
						this.toast.show('Failed to update passion level')
					})
			})
	}

	public passionIcon(artist: FollowedArtist): string {
		return PASSION_LEVEL_META[artist.passionLevel]?.icon ?? '🔥'
	}

	// --- View toggle ---

	public toggleView(): void {
		this.viewMode = this.viewMode === 'list' ? 'grid' : 'list'
	}

	// --- Grid context menu ---

	public onGridLongPress(artist: FollowedArtist): void {
		this.contextMenuArtist = artist
	}

	public closeContextMenu(): void {
		this.contextMenuArtist = null
	}

	public contextMenuSetLevel(level: PassionLevel): void {
		if (!this.contextMenuArtist) return
		const artist = this.contextMenuArtist
		this.closeContextMenu()

		// Block during onboarding (no backend RPC available)
		if (this.isOnboarding) return

		const prev = artist.passionLevel
		if (prev === level) return

		artist.passionLevel = level
		const client = this.artistService.getClient()
		const req = {
			artistId: new ArtistId({ value: artist.id }),
			passionLevel: level,
		}
		client.setPassionLevel(req).catch((firstErr) => {
			this.logger.warn('Passion level update failed, retrying', {
				error: firstErr,
			})
			client.setPassionLevel(req).catch((retryErr) => {
				this.logger.error('Failed to update passion level after retry', {
					error: retryErr,
				})
				artist.passionLevel = prev
				this.toast.show('Failed to update passion level')
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
		return artist.passionLevel === PassionLevel.MUST_GO
			? 'col-span-2 row-span-2'
			: ''
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
