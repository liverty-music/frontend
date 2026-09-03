import { I18N } from '@aurelia/i18n'
import { IEventAggregator, ILogger, observable, resolve, watch } from 'aurelia'
import { artistColor } from '../../adapter/view/artist-color'
import { HYPE_TIERS } from '../../adapter/view/hype-display'
import type { PageHelp } from '../../components/page-help/page-help'
import { Snack, type SnackHandle } from '../../components/snack-bar/snack'
import type { FollowedArtist, Hype } from '../../entities/follow'
import { IAuthService } from '../../services/auth-service'
import {
	type FabAction,
	helpAction,
	IFabMenuService,
} from '../../services/fab-menu-service'
import { IFollowStore } from '../../services/follow-store'
import { IOnboardingService } from '../../services/onboarding-service'

export interface MyArtist extends FollowedArtist {
	color: string
}

export class MyArtistsRoute {
	public artists: MyArtist[] = []
	public isLoading = true

	public showSignupBanner = false

	// Edit-mode state: toggles per-row remove controls. @observable so the FAB
	// context @watch re-registers when edit mode enters/exits (the launcher hides
	// while editing; exit is via the in-list Done bar).
	@observable public editing = false

	// Hype state tracking
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

	private readonly followStore = resolve(IFollowStore)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly ea = resolve(IEventAggregator)
	private readonly fabMenu = resolve(IFabMenuService)
	private abortController: AbortController | null = null

	/** Help sheet ref; its trigger lives in the FAB launcher. */
	public pageHelp: PageHelp | undefined
	/** Disposer for this route's contributed FAB actions. */
	private fabDisposer: (() => void) | null = null

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
		// Synchronous prelude only — set before first paint. The fetch is kicked
		// off non-blocking so the router attaches this view immediately instead of
		// holding the outgoing screen frozen until the RPC resolves. The
		// AbortController is owned by loadArtists() (single owner): creating it
		// here too would let loadArtists()'s abort-first abort the just-created
		// controller, AbortError-ing the very first load.
		this.isLoading = true
		// Edit mode is not persisted across navigation — always start fresh.
		this.editing = false
		void this.loadArtists()

		// Signup banner visible for any guest user on this page (during AND after
		// onboarding) — per signup-prompt-banner capability "Banner appears for
		// guest user during onboarding" / "after onboarding" scenarios.
		if (!this.isAuthenticated) {
			this.showSignupBanner = true
		}
	}

	/**
	 * Fetch followed artists. Owns the request AbortController (abort-first then
	 * create), mirroring dashboard-route.ts's loadData(). Returns a Promise so
	 * production can fire-and-forget it (`void this.loadArtists()`) while tests
	 * await it deterministically.
	 */
	public async loadArtists(): Promise<void> {
		this.abortController?.abort()
		this.abortController = new AbortController()
		this.isLoading = true

		try {
			const followed = await this.followStore.listFollowed(
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
	}

	public attached(): void {
		// @watch does not fire on initial bind, so seed the registration here.
		this.refreshFabActions()
	}

	/** Edit is available only once there are followed artists to edit. */
	private get canEdit(): boolean {
		return !this.isLoading && this.artists.length > 0
	}

	/**
	 * This route's FAB actions. Edit lives in the launcher — not the top-right
	 * header "dead zone" this feature exists to eliminate. It is a COMMAND (not a
	 * toggle): tapping it enters edit mode and closes the launcher so the user
	 * lands directly on the un-dimmed, editable list. While editing, the launcher
	 * contributes nothing (the FAB hides); exit is via the in-list Done bar.
	 */
	private buildFabActions(): FabAction[] {
		if (this.editing) return []
		const actions: FabAction[] = [helpAction(() => this.pageHelp?.open())]
		if (this.canEdit) {
			actions.push({
				id: 'edit',
				labelKey: 'myArtists.edit',
				icon: 'edit',
				kind: 'command',
				invoke: () => this.toggleEditing(),
			})
		}
		return actions
	}

	/**
	 * Re-register whenever edit mode or edit-availability changes, so the launcher
	 * hides on entering edit and the edit item appears/drops with the list — one
	 * declarative trigger rather than scattered manual refresh calls (mirrors the
	 * dashboard's context @watch).
	 */
	@watch((vm: MyArtistsRoute) => `${vm.editing}|${vm.canEdit}`)
	protected onFabContextChanged(): void {
		this.refreshFabActions()
	}

	private refreshFabActions(): void {
		this.fabDisposer?.()
		this.fabDisposer = this.fabMenu.register(this, this.buildFabActions())
	}

	public detaching(): void {
		this.fabDisposer?.()
		this.fabDisposer = null
		this.abortController?.abort()
		this.abortController = null
		this.undoHandle?.dismiss()
		this.editing = false
	}

	// --- Edit-mode toggle ---

	public toggleEditing(): void {
		this.editing = !this.editing
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
			// Auto-exit edit mode when the last artist is removed (the FAB context
			// @watch re-registers the launcher off the `editing` change).
			if (this.artists.length === 0) {
				this.editing = false
			}
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

		// unfollowArtist() is only reachable via the edit-mode remove button, so
		// edit mode was active when this artist was removed. Restore it so the user
		// can continue removing without having to re-enter edit mode.
		this.editing = true

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
			// Guest unfollow resolves synchronously (localStorage write, no RPC),
			// so there is no retry/revert path — followStore routes to the guest
			// queue internally based on auth state.
			void this.followStore.unfollow(artistId)
			this.logger.info('Unfollow committed (guest)', {
				name: artistName,
			})
			return
		}

		// Fire-and-forget RPC with 1 retry
		this.followStore
			.unfollow(artistId)
			.then(() => {
				this.logger.info('Unfollow committed', { name: artistName })
			})
			.catch((firstErr) => {
				this.logger.warn('Unfollow failed, retrying', {
					name: artistName,
					error: firstErr,
				})
				this.followStore
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

	public onHypeInput(artist: MyArtist, newHype: Hype): void {
		const artistId = artist.artist.id
		const prev = this.prevHypes.get(artistId) ?? 'watch'
		if (prev === newHype) return

		// Update the artist object so Aurelia re-renders the dot selection
		artist.hype = newHype
		const hype = newHype

		// Hype editing is fully decoupled from onboarding state (#444): every
		// change applies and persists, and onboarding is never mutated here.
		//
		// Unauthenticated: persist to guest storage. The signup banner is already
		// visible from loading(); no host-side toggle needed. followStore routes to
		// the guest queue internally (synchronous localStorage write, no RPC).
		if (!this.isAuthenticated) {
			this.prevHypes.set(artistId, hype)
			void this.followStore.setHype(artistId, hype)
			return
		}

		// Authenticated: accept and persist
		this.prevHypes.set(artistId, hype)

		this.followStore
			.setHype(artistId, hype)
			.then(() => {
				this.logger.info('Hype level updated', { artistId, hype })
			})
			.catch((firstErr) => {
				this.logger.warn('Hype level update failed, retrying', {
					artistId,
					error: firstErr,
				})
				this.followStore
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

	public hypeIcon(artist: MyArtist): string {
		return HYPE_TIERS[artist.hype]?.icon ?? '\u{1F525}'
	}
}
