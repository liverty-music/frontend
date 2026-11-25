import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { IEventAggregator, ILogger, observable, resolve, watch } from 'aurelia'
import { Snack, type SnackHandle } from '../../../shared/ui/snack-bar/snack'
import {
	loadHypeSnackSeen,
	saveHypeSnackSeen,
} from '../../adapter/storage/onboarding-storage'
import { artistColor } from '../../adapter/view/artist-color'
import { HYPE_TIERS, hypeReachWords } from '../../adapter/view/hype-display'
import type { HomeAreaSelector } from '../../components/home-area-selector/home-area-selector'
import type { PageHelp } from '../../components/page-help/page-help'
import {
	DEFAULT_HYPE,
	type FollowedArtist,
	type Hype,
} from '../../entities/follow'
import {
	helpAction,
	IActionMenuService,
	type MenuAction,
} from '../../services/action-menu-service'
import { IAuthService } from '../../services/auth-service'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { IFollowStore } from '../../services/follow-store'
import { IGuideService } from '../../services/guide-service'
import { INotificationPromptService } from '../../services/notification-prompt-service'
import { IOnboardingService } from '../../services/onboarding-service'
import { IUserStore } from '../../services/user-store'
import { currentLanguage } from '../../util/change-locale'
import { inListTransition } from '../../util/list-transition'

export interface MyArtist extends FollowedArtist {
	color: string
}

export class MyArtistsRoute {
	public artists: MyArtist[] = []
	public isLoading = true

	public showSignupBanner = false

	/**
	 * The person has no home area, so the home sheet is open (or was closed by a
	 * guest after onboarding). Decided when the route opens, as on the Timetable.
	 */
	public needsHome = false
	public homeSelector: HomeAreaSelector | undefined

	// Edit-mode state: toggles per-row remove controls. @observable so
	// `editingChanged` hides the launcher while editing (exit is via the in-list
	// Done bar).
	@observable public editing = false

	// Hype state tracking
	private prevHypes = new Map<string, Hype>()

	// Undo state
	private undoArtist: MyArtist | null = null
	private undoIndex = -1
	private undoHandle: SnackHandle | null = null

	private readonly logger = resolve(ILogger).scopeTo('MyArtistsRoute')
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)

	private readonly followStore = resolve(IFollowStore)
	private readonly guide = resolve(IGuideService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly ea = resolve(IEventAggregator)
	private readonly actionMenu = resolve(IActionMenuService)
	private readonly notificationPrompt = resolve(INotificationPromptService)
	private readonly router = resolve(IRouter)
	public readonly userStore = resolve(IUserStore)
	private abortController: AbortController | null = null

	/** Help sheet ref; its trigger lives in the FAB launcher. */
	public pageHelp: PageHelp | undefined
	/** Disposer for this route's contributed FAB actions. */
	private fabDisposer: (() => void) | null = null
	// Shows the launcher again; held while edit mode hides it.
	private showLauncher: (() => void) | null = null

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get isAuthenticated(): boolean {
		return this.authService.isAuthenticated
	}

	/**
	 * The home sheet closes only on a choice for a signed-in fan and for a guest
	 * in onboarding; a guest after onboarding may close it.
	 */
	public get homeRequired(): boolean {
		return this.isAuthenticated || this.isOnboarding
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
		// A person without a home area is asked for it here and on the Timetable,
		// every time either screen opens until they choose one.
		this.needsHome = this.userStore.needsHome
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
	 * create), mirroring timetable-route.ts's loadData(). Returns a Promise so
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
			// With the home-area sheet up, the moment waits until it has closed.
			if (!this.needsHome) this.requestHypeMoment()
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
		this.refreshMenuActions()
		// The sheet is in the DOM only now, so showPopover() works.
		if (this.needsHome) this.homeSelector?.open()
	}

	/**
	 * The person chose a home area in the sheet. The store saves it, through
	 * SetHome for a signed-in fan and on the device for a guest. When the save
	 * fails it says so and rejects, so the sheet stays open on the choice.
	 */
	public async onHomeSelected(code: string): Promise<void> {
		try {
			await this.userStore.saveHome(code)
		} catch (err) {
			this.logger.error('Failed to save the home area', { error: err })
			this.ea.publish(
				new Snack(this.i18n.tr('homeAreaSelector.saveFailed'), 'error'),
			)
			// Still without a home: the sheet stays open on the choice.
			throw err
		}
		this.needsHome = false
	}

	/**
	 * The home sheet has finished closing: the hype dots' guide moment, held
	 * back while it was open, may show now.
	 */
	public onHomeSheetHidden(): void {
		if (!this.isLoading) this.requestHypeMoment()
	}

	/**
	 * The hype dots' guide moment, for a guest and a signed-in fan alike: at
	 * least one followed artist, and none moved off the default Nearby (my-artists
	 * "The hype dots' guide moment").
	 */
	private requestHypeMoment(): void {
		if (this.artists.length === 0) return
		if (this.artists.some((a) => a.hype !== DEFAULT_HYPE)) return
		this.guide.request('myArtists.hype')
	}

	/** Edit is available only once there are followed artists to edit. */
	private get canEdit(): boolean {
		return !this.isLoading && this.artists.length > 0
	}

	/**
	 * This route's FAB actions. Edit lives in the launcher — not the top-right
	 * header "dead zone" this feature exists to eliminate. It is a COMMAND (not a
	 * toggle): tapping it enters edit mode and closes the launcher so the user
	 * lands directly on the un-dimmed, editable list. While editing, the route
	 * hides the launcher (`editingChanged`); exit is via the in-list Done bar.
	 */
	private buildMenuActions(): MenuAction[] {
		// The first action sits closest to the FAB on the thumb arc.
		const actions: MenuAction[] = []
		if (this.canEdit) {
			actions.push({
				id: 'edit',
				labelKey: 'myArtists.edit',
				icon: 'edit',
				kind: 'command',
				invoke: () => this.toggleEditing(),
			})
		}
		actions.push(helpAction(() => this.pageHelp?.open()))
		return actions
	}

	/**
	 * Re-register whenever edit-availability changes, so the edit item appears
	 * and drops with the list — one declarative trigger rather than scattered
	 * manual refresh calls (mirrors the timetable's context @watch).
	 */
	@watch((vm: MyArtistsRoute) => vm.canEdit)
	protected onFabContextChanged(): void {
		this.refreshMenuActions()
	}

	/**
	 * Edit mode hides the whole launcher, the Settings item of the tab pages
	 * included, and shows it again when edit mode ends: on Done, when the last
	 * artist is removed, and on leaving the page (`detaching`).
	 */
	public editingChanged(editing: boolean): void {
		if (editing) {
			this.showLauncher ??= this.actionMenu.hide(this)
		} else {
			this.showLauncher?.()
			this.showLauncher = null
		}
	}

	private refreshMenuActions(): void {
		this.fabDisposer?.()
		this.fabDisposer = this.actionMenu.register(this, this.buildMenuActions())
	}

	public detaching(): void {
		this.guide.dismiss('myArtists.hype', 'route_leave')
		this.fabDisposer?.()
		this.fabDisposer = null
		this.abortController?.abort()
		this.abortController = null
		this.undoHandle?.dismiss()
		this.editing = false
	}

	// --- Edit-mode toggle ---

	public toggleEditing(): void {
		void inListTransition(() => {
			this.editing = !this.editing
		})
	}

	// --- Unfollow with undo ---

	public unfollowArtist(artist: MyArtist): void {
		// Block unfollow during onboarding
		if (this.isOnboarding) return

		// Dismiss any previous undo snack (commits that unfollow)
		this.undoHandle?.dismiss()

		const artistId = this.artistId(artist)
		const artistName = this.artistName(artist)
		const index = this.artists.findIndex((a) => a.artist.id === artistId)
		if (index === -1) return

		// Optimistic removal, inside a View Transition.
		const doRemove = () => {
			this.artists.splice(index, 1)
			this.undoArtist = artist
			this.undoIndex = index
			// Auto-exit edit mode when the last artist is removed
			// (`editingChanged` shows the launcher again).
			if (this.artists.length === 0) {
				this.editing = false
			}
		}

		void inListTransition(doRemove)

		this.logger.info('Artist unfollowed (pending)', { name: artistName })

		const snack = new Snack(
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
		this.ea.publish(snack)
		this.undoHandle = snack.handle
	}

	private undo(): void {
		if (!this.undoArtist) return

		// Re-insert at original position, in the same transition as the removal
		// so the rows below make room instead of jumping down.
		const insertAt = Math.min(this.undoIndex, this.artists.length)
		const restored = this.undoArtist
		void inListTransition(() => {
			this.artists.splice(insertAt, 0, restored)

			// unfollowArtist() is only reachable via the edit-mode remove button,
			// so edit mode was active when this artist was removed. Restore it so
			// the user can continue removing without having to re-enter edit mode.
			this.editing = true
		})

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

	// --- Hype level change (a row's `hype-changed` event) ---

	public onHypeInput(artist: MyArtist, newHype: Hype): void {
		const artistId = artist.artist.id
		const prev = this.prevHypes.get(artistId) ?? 'watch'
		if (prev === newHype) return
		this.guide.acted('myArtists.hype')

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
			this.showGuestHypeSnack(artist, hype)
			return
		}

		// Authenticated: accept and persist
		this.prevHypes.set(artistId, hype)

		this.followStore
			.setHype(artistId, hype)
			.then(() => {
				this.logger.info('Hype level updated', { artistId, hype })
				void this.showHypeSnack(artist, hype)
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
						void this.showHypeSnack(artist, hype)
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

	/**
	 * After a saved hype change, say which new concerts of the artist reach
	 * the fan by push. With push on, a level's snack shows only the first time
	 * the fan picks it on this device. With push off it shows on every change
	 * except Watch, and its action offers push, or opens Settings where the
	 * browser blocked or cannot receive it. A newer snack for the same artist
	 * replaces the earlier one.
	 */
	private async showHypeSnack(artist: MyArtist, hype: Hype): Promise<void> {
		const state = await this.notificationPrompt.pushState()
		if (state === 'on') {
			if (loadHypeSnackSeen(hype)) return
			saveHypeSnackSeen(hype)
			const message =
				hype === 'watch'
					? this.i18n.tr('hypeReach.watch', { name: artist.artist.name })
					: this.hypeSnackText('hypeReach.on', artist, hype)
			this.publishHypeSnack(artist, message)
			return
		}
		if (hype === 'watch') return
		const action =
			state === 'offerable'
				? {
						label: this.i18n.tr('notificationPrompt.action'),
						callback: () => {
							void this.notificationPrompt.accept({
								source: 'notification_prompt',
							})
						},
					}
				: {
						label: this.i18n.tr('hypeReach.settings'),
						callback: () => {
							void this.router.load('settings')
						},
					}
		this.publishHypeSnack(
			artist,
			this.hypeSnackText('hypeReach.off', artist, hype),
			action,
		)
	}

	/**
	 * A guest's hype change: the first pick of a level other than Watch on
	 * this device invites the guest to sign up to receive push.
	 */
	private showGuestHypeSnack(artist: MyArtist, hype: Hype): void {
		if (hype === 'watch' || loadHypeSnackSeen(hype)) return
		saveHypeSnackSeen(hype)
		this.publishHypeSnack(
			artist,
			this.hypeSnackText('hypeReach.off', artist, hype),
			{
				label: this.i18n.tr('hypeReach.signUp'),
				callback: () => this.onSignupRequested(),
			},
		)
	}

	private hypeSnackText(key: string, artist: MyArtist, hype: Hype): string {
		return this.i18n.tr(key, {
			name: artist.artist.name,
			places: hypeReachWords(
				hype,
				this.userStore.currentHome ?? undefined,
				(k, o) => this.i18n.tr(k, o),
			),
		})
	}

	private publishHypeSnack(
		artist: MyArtist,
		message: string,
		action?: { label: string; callback: () => void },
	): void {
		this.ea.publish(
			new Snack(message, 'info', {
				icon: 'bell',
				replaceKey: `hype:${artist.artist.id}`,
				...(action && { action }),
			}),
		)
	}

	public onSignupRequested(): void {
		this.errorBoundary.addBreadcrumb('action', 'start_sign_up')
		this.authService.signUp({
			uiLocales: currentLanguage(this.i18n),
			source: 'my_artists_prompt',
		})
	}

	public hypeIcon(artist: MyArtist): string {
		return HYPE_TIERS[artist.hype]?.icon ?? '\u{1F525}'
	}
}
