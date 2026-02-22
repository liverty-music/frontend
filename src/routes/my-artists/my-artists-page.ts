import { IRouter } from '@aurelia/router'
import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ILogger, resolve } from 'aurelia'
import { artistColor } from '../../components/live-highway/color-generator'
import { IArtistServiceClient } from '../../services/artist-service-client'

export interface FollowedArtist {
	id: string
	name: string
	color: string
}

const UNDO_TIMEOUT_MS = 5000

export class MyArtistsPage {
	public artists: FollowedArtist[] = []
	public isLoading = true

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

	private readonly logger = resolve(ILogger).scopeTo('MyArtistsPage')
	private readonly artistService = resolve(IArtistServiceClient)
	private readonly router = resolve(IRouter)
	private abortController: AbortController | null = null

	public async loading(): Promise<void> {
		this.isLoading = true
		this.abortController = new AbortController()

		try {
			const client = this.artistService.getClient()
			const response = await client.listFollowed(
				{},
				{ signal: this.abortController.signal },
			)
			this.artists = response.artists.map((a) => ({
				id: a.id?.value ?? '',
				name: a.name?.value ?? '',
				color: artistColor(a.name?.value ?? ''),
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

		e.preventDefault()
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
		this.undoArtist = null
		this.undoVisible = false

		// Fire-and-forget RPC
		const client = this.artistService.getClient()
		client
			.unfollow({ artistId: new ArtistId({ value: artist.id }) })
			.then(() => {
				this.logger.info('Unfollow committed', { name: artist.name })
			})
			.catch((err) => {
				this.logger.error('Failed to unfollow artist', {
					name: artist.name,
					error: err,
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

	// --- Navigation ---

	public async goToDiscover(): Promise<void> {
		await this.router.load('discover')
	}
}
