import { I18N } from '@aurelia/i18n'
import {
	IRouter,
	type IRouteViewModel,
	type NavigationInstruction,
} from '@aurelia/router'
import {
	IEventAggregator,
	ILogger,
	INode,
	observable,
	resolve,
	runTasks,
} from 'aurelia'
import type { EventDetailSheet } from '../../components/live-highway/event-detail-sheet'
import type { LiveEvent } from '../../components/live-highway/live-event'
import { Snack } from '../../components/snack-bar/snack'
import {
	getPreviewArtistIds,
	getPreviewArtistNameMap,
	PREVIEW_MIN_ARTISTS_WITH_CONCERTS,
} from '../../constants/preview-artists'
import type { Artist } from '../../entities/artist'
import type { Concert, DateGroup } from '../../entities/concert'
import type { Hype } from '../../entities/follow'
import { IAuthService } from '../../services/auth-service'
import { IConcertStore } from '../../services/concert-store'
import { IFollowStore } from '../../services/follow-store'
import { IUserStore } from '../../services/user-store'
import { changeLocale, SUPPORTED_LANGUAGES } from '../../util/change-locale'
import { prefersReducedMotion } from '../../util/prefers-reduced-motion'

/** Phase of the guided product demo below the hero. */
type DemoPhase = 'notification' | 'timetable'

/** Auto-advance the notification into the timetable if the visitor doesn't tap. */
const DEMO_AUTO_ADVANCE_MS = 5000

/**
 * How long the notification's exit animation runs before the timetable appears.
 * The two are sequential (dismiss fully completes, then the timetable enters),
 * so this must match the exit keyframe duration in CSS.
 */
const NOTIF_EXIT_MS = 380

/**
 * Wait after the timetable appears before nudging with the coach-mark — a
 * visitor who taps a card on their own within this window never sees it.
 */
const COACH_DELAY_MS = 5000

export class WelcomeRoute implements IRouteViewModel {
	private readonly authService = resolve(IAuthService)
	private readonly userStore = resolve(IUserStore)
	private readonly followStore = resolve(IFollowStore)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('WelcomeRoute')
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)
	private readonly concertService = resolve(IConcertStore)
	private readonly host = resolve(INode) as HTMLElement

	public readonly supportedLanguages = SUPPORTED_LANGUAGES

	/** Preview concert data for the timetable demo on the welcome page. */
	@observable public dateGroups: DateGroup[] = []

	/**
	 * Guided demo phase. Starts on the mock notification (S0); advances to the
	 * interactive timetable (S2) on tap or auto-advance. Bound by `if.bind` in the
	 * template.
	 */
	public demoPhase: DemoPhase = 'notification'

	/** Drives the coach-mark that points at the first concert card once interactive. */
	public coachActive = false

	/**
	 * Set true when the demo first scrolls into view. Gates the notification's
	 * entrance animation so it plays *as the visitor arrives* — not on mount while
	 * the demo is still below the fold (where it would finish unseen).
	 */
	public demoEntered = false

	/** True while the notification plays its exit animation, before the swap. */
	public demoExiting = false

	/** Bound via `component.ref` — the real detail sheet opened by card taps. */
	public detailSheet?: EventDetailSheet

	/** Set by `ref` in the template — the demo section observed for scroll entry. */
	public demoEl?: HTMLElement

	private abortController: AbortController | null = null
	private demoObserver: IntersectionObserver | null = null
	private demoStarted = false
	private autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null
	private coachTimer: ReturnType<typeof setTimeout> | null = null
	private exitTimer: ReturnType<typeof setTimeout> | null = null

	/**
	 * Active UI language for the language picker's `checked.bind`, projected from
	 * UserStore rather than a local mirror field. Welcome is anonymous-only, so
	 * `currentLanguage` resolves to the reactive `i18nLocale` mirror — always
	 * equal to the active i18n locale. Bound one-way; the radio's `change.trigger`
	 * routes the selection through `selectLanguage` so the single source of truth
	 * stays in UserStore / the active locale.
	 */
	public get currentLocale(): string {
		return this.userStore.currentLanguage
	}

	public attached(): void {
		void this.loadPreviewData()
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
		this.clearAutoAdvance()
		this.clearCoachTimer()
		if (this.exitTimer) {
			clearTimeout(this.exitTimer)
			this.exitTimer = null
		}
		this.demoObserver?.disconnect()
		this.demoObserver = null
	}

	/**
	 * Fires when `dateGroups` changes (via `@observable`). Once preview data is
	 * available the demo section is stamped by `if.bind`; a microtask lets that
	 * settle before we observe it for scroll entry.
	 */
	protected dateGroupsChanged(): void {
		if (this.dateGroups.length === 0) return
		// `runTasks()` flushes Aurelia's render queue so the `if.bind` section and
		// its `ref="demoEl"` exist before we query them — a bare microtask can run
		// before that flush, leaving demoEl undefined and the demo never armed.
		queueMicrotask(() => {
			runTasks()
			this.setupDemoTrigger()
		})
	}

	/**
	 * Arm a one-shot IntersectionObserver so the guided demo starts the first time
	 * it scrolls into view. Under reduced motion the demo is presented in its final
	 * interactive state immediately (see `startDemo`).
	 */
	private setupDemoTrigger(): void {
		if (this.demoStarted) return
		const el = this.demoEl
		if (!el) return
		this.demoObserver?.disconnect()
		this.demoObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						this.startDemo()
						this.demoObserver?.disconnect()
						this.demoObserver = null
						break
					}
				}
			},
			{ threshold: 0.55 },
		)
		this.demoObserver.observe(el)
	}

	/**
	 * Begin the guided demo. With motion: hold on the notification (S0) and start
	 * the auto-advance timer. Under reduced motion: skip straight to the
	 * interactive timetable so nothing moves and the end state is immediately usable.
	 */
	private startDemo(): void {
		if (this.demoStarted) return
		this.demoStarted = true
		// Trigger the notification's entrance now that the demo is on screen.
		this.demoEntered = true

		if (prefersReducedMotion()) {
			this.demoPhase = 'timetable'
			this.activateCoachAfterRender()
			return
		}

		this.autoAdvanceTimer = setTimeout(() => {
			void this.advanceToTimetable()
		}, DEMO_AUTO_ADVANCE_MS)
	}

	/** S0 → S1: the visitor tapped the mock push notification. */
	public onNotificationTap(): void {
		void this.advanceToTimetable()
	}

	/**
	 * Advance from the notification to the interactive timetable. The two are
	 * sequential: the notification plays its exit animation (driven by
	 * `demoExiting`), and only once it has fully dismissed does the timetable
	 * appear (with its own entrance). Under reduced motion the swap is instant.
	 */
	private advanceToTimetable(): void {
		if (this.demoPhase === 'timetable' || this.demoExiting) return
		this.clearAutoAdvance()

		if (prefersReducedMotion()) {
			this.demoPhase = 'timetable'
			this.activateCoachAfterRender()
			return
		}

		this.demoExiting = true
		this.exitTimer = setTimeout(() => {
			this.exitTimer = null
			this.demoExiting = false
			this.demoPhase = 'timetable'
			this.activateCoachAfterRender()
		}, NOTIF_EXIT_MS)
	}

	/**
	 * After the timetable renders, wait `COACH_DELAY_MS` before showing the
	 * coach-mark. `runTasks()` flushes the queued DOM writes so its target query
	 * resolves; the delay gives a self-directed visitor time to tap a card first
	 * (which cancels the coach via `onEventSelected`).
	 */
	private activateCoachAfterRender(): void {
		queueMicrotask(() => runTasks())
		this.clearCoachTimer()
		this.coachTimer = setTimeout(() => {
			this.coachActive = true
		}, COACH_DELAY_MS)
	}

	/** A concert card was activated → open the product's real detail sheet. */
	public onEventSelected(event: CustomEvent<{ event: LiveEvent }>): void {
		this.clearCoachTimer()
		this.coachActive = false
		this.detailSheet?.open(event.detail.event, 'page', false)
	}

	/** Coach-mark tapped: it forwards the tap to the card (which opens the sheet). */
	public onCoachTap(): void {
		this.coachActive = false
	}

	/** Coach-mark light-dismissed by an outside tap. */
	public onCoachDismiss(): void {
		this.coachActive = false
	}

	private clearAutoAdvance(): void {
		if (this.autoAdvanceTimer) {
			clearTimeout(this.autoAdvanceTimer)
			this.autoAdvanceTimer = null
		}
	}

	private clearCoachTimer(): void {
		if (this.coachTimer) {
			clearTimeout(this.coachTimer)
			this.coachTimer = null
		}
	}

	private async loadPreviewData(): Promise<void> {
		// Dev-only shortcut: ?devPreview=1 injects static mock data so the LP
		// demo can be reviewed without a running backend.
		if (
			import.meta.env.DEV &&
			new URLSearchParams(window.location.search).get('devPreview') === '1'
		) {
			this.dateGroups = buildDevPreviewGroups()
			return
		}

		const previewIds = getPreviewArtistIds()
		if (previewIds.length === 0) return

		this.abortController?.abort()
		this.abortController = new AbortController()

		try {
			const groups = await this.concertService.listByArtists(
				previewIds,
				'JP',
				'JP-13',
				this.abortController.signal,
			)

			// Build artist map from configured names (preview has no followed artists).
			// Preview-only synthetic hype. Intentionally NOT DEFAULT_HYPE — `watch`
			// makes preview concerts render as "unmatched" (faded-poster treatment)
			// per the passion-level hype-lane match rule, which keeps the welcome
			// page softer than a real fan's dashboard. Changing this to DEFAULT_HYPE
			// would shift the visual treatment to "matched" (festival-stage) and
			// alter the welcome page's intended aesthetic.
			const artistMap = new Map<string, { artist: Artist; hype: Hype }>()
			for (const [id, name] of getPreviewArtistNameMap()) {
				artistMap.set(id, {
					artist: { id, name, mbid: '' },
					hype: 'watch',
				})
			}

			const allGroups = this.concertService.toDateGroups(groups, artistMap)

			// Cap preview at ~30 concerts to avoid overwhelming the visitor
			const MAX_PREVIEW_CONCERTS = 30
			const capped: DateGroup[] = []
			let total = 0
			const artistsWithData = new Set<string>()

			for (const g of allGroups) {
				const concerts = [...g.home, ...g.nearby, ...g.away]
				// resolved counts only the concerts that contribute a real
				// artist to artistsWithData. Counting every concert (incl.
				// those with blank artistId from a failed performer
				// resolution) could exhaust the 30-slot cap on unresolved
				// rows alone, breaking the loop before enough artist-matched
				// concerts are seen and silently suppressing the preview
				// even when valid data exists past the cap boundary.
				let resolved = 0
				for (const c of concerts) {
					if (c.artistId) {
						artistsWithData.add(c.artistId)
						resolved++
					}
				}
				total += resolved
				// Drop the entire group when none of its concerts resolved
				// AND strip blank-artist concerts from partially-resolved
				// groups before pushing. The previous group-level guard
				// alone still leaked individual ghost cards from a mixed
				// group into the unauthenticated preview.
				if (resolved > 0) {
					capped.push({
						...g,
						home: g.home.filter((c) => c.artistId),
						nearby: g.nearby.filter((c) => c.artistId),
						away: g.away.filter((c) => c.artistId),
					})
				}
				if (total >= MAX_PREVIEW_CONCERTS) break
			}

			if (artistsWithData.size < PREVIEW_MIN_ARTISTS_WITH_CONCERTS) {
				this.logger.debug('Not enough artists with concerts for preview', {
					found: artistsWithData.size,
				})
				return
			}

			this.dateGroups = capped
		} catch (err) {
			this.logger.warn('Preview data load failed', { error: err })
		}
	}

	/**
	 * Apply a language picked from the radio group. Driven by the radio's
	 * `change.trigger` (one-way `checked.bind` reads the projection from
	 * UserStore, this writes through it) rather than a standalone @observable
	 * mirror. Routes through the shared `changeLocale`, which on the
	 * unauthenticated path applies `i18n.setLocale` then persists the choice to
	 * the single `localStorage['language']` key.
	 */
	public async selectLanguage(newLocale: string): Promise<void> {
		if (!newLocale || newLocale === this.i18n.getLocale()) return
		// Welcome is anonymous-only — canLoad redirects authenticated
		// callers to /dashboard before this code runs, so
		// `authService.isAuthenticated` is guaranteed false here. The
		// `userStore.updatePreferredLanguage` branch inside changeLocale
		// is therefore intentional dead code from this call site.
		//
		// We still call the shared changeLocale (rather than inlining the
		// anonymous path) so the welcome page and settings page route
		// every locale change through one validation + persistence policy.
		await changeLocale(
			{
				i18n: this.i18n,
				auth: this.authService,
				userStore: this.userStore,
			},
			newLocale,
		)
	}

	async canLoad(): Promise<NavigationInstruction | boolean> {
		this.logger.debug('Checking if landing page can load')

		await this.authService.ready

		if (this.authService.isAuthenticated) {
			this.logger.info('User is authenticated, redirecting to dashboard')
			return 'dashboard'
		}

		// Welcome is intentionally reachable during onboarding so users can
		// re-read the value proposition. Merely viewing it must not reset
		// onboarding — onboardingStep only changes when [Get Started] is tapped
		// (see handleGetStarted). Login is reachable from Settings, so Welcome
		// is no longer the only way back to an auth entry.
		return true
	}

	/**
	 * Scrolls the guided demo into view. Whether the scroll is smooth or instant is
	 * decided entirely by the scroll container's CSS `scroll-behavior` (`smooth`,
	 * overridden to `auto` under `prefers-reduced-motion`) — no `behavior` is passed
	 * here so motion policy has a single source of truth in CSS. No-op when the demo
	 * is not rendered (i.e. `dateGroups` is empty).
	 */
	scrollToPreview(): void {
		this.host
			.querySelector<HTMLElement>('.welcome-demo')
			?.scrollIntoView({ block: 'start' })
	}

	async handleGetStarted(): Promise<void> {
		this.logger.info('Get Started tapped, entering onboarding')
		// Just navigate to discovery — onboarding is a single flag that already
		// defaults to true for a not-yet-completed user, and guest data is
		// preserved. There is no step cursor to set.
		try {
			await this.router.load('discovery')
		} catch (err) {
			this.logger.error('Failed to navigate to discovery', { error: err })
			this.ea.publish(new Snack(this.i18n.tr('welcome.error.navigation')))
		}
	}

	/**
	 * Coordinated guest-state reset replacing the old `GuestService.clearAll()`.
	 * UserStore owns home/language/help-seen; FollowStore owns the follow queue +
	 * projection cache. Both clears are idempotent and order-independent.
	 */
	private resetGuestState(): void {
		this.userStore.clearGuest()
		this.followStore.clearGuest()
	}

	async handleLogin(): Promise<void> {
		this.logger.info('Login tapped')
		// Discard any anonymous trial state (guest follows, guest home) before
		// starting sign-in. Login is an explicit assertion of "I am a returning
		// user", so leftover guest data must not leak into auth-callback's
		// post-sign-in heuristics — most importantly the guestHome-driven
		// new-signup detection in ensureUserProvisioned, which would otherwise
		// surface PostSignupDialog to an existing user who happened to pick a
		// home during a prior anonymous session.
		//
		// Coordinated reset across the stores that now own the guest slices:
		// UserStore drops home/help-seen; FollowStore drops the follow queue +
		// projection cache. Together these reproduce the old
		// GuestService.clearAll() semantics. The locale is untouched — it lives
		// solely in the i18next detector's `language` key, which persists across
		// the reset (the cancelled-login behavior).
		this.resetGuestState()
		try {
			await this.authService.signIn()
		} catch (err) {
			this.logger.error('Failed to start sign-in flow', { error: err })
			this.ea.publish(new Snack(this.i18n.tr('welcome.error.login')))
		}
	}
}

/**
 * Static mock DateGroup data for local dev review of the LP demo. Distributes
 * concerts across the HOME / NEAR / AWAY lanes (like real proximity data) so the
 * timetable reads as full, not lop-sided. Only reachable when
 * `import.meta.env.DEV && ?devPreview=1` — never ships.
 */
function buildDevPreviewGroups(): DateGroup[] {
	const artist = (id: string, name: string): Artist => ({ id, name, mbid: '' })
	const concert = (
		id: string,
		name: string,
		venue: string,
		location: string,
		date: Date,
		start: string,
		open: string,
		title: string,
		merch: string,
	): Concert => ({
		id,
		artistName: name,
		artistId: id,
		venueName: venue,
		locationLabel: location,
		date,
		startTime: start,
		openTime: open,
		title,
		sourceUrl: 'https://example.com',
		merchUrl: merch,
		hypeLevel: 'watch',
		matched: false,
		artist: artist(id, name),
	})

	return [
		{
			label: '9月15日（月）',
			dateKey: '2026-09-15',
			isFirstOfMonth: true,
			monthSeparatorLabel: '2026年9月',
			home: [
				concert(
					'm1',
					'Mrs. GREEN APPLE',
					'東京ドーム',
					'東京都文京区',
					new Date('2026-09-15'),
					'18:00',
					'17:00',
					'Mrs. GREEN APPLE ARENA TOUR 2026',
					'https://mgapple.jp/merch',
				),
			],
			nearby: [
				concert(
					'm2',
					'YOASOBI',
					'幕張メッセ',
					'千葉県千葉市',
					new Date('2026-09-15'),
					'19:00',
					'18:00',
					'YOASOBI LIVE 2026',
					'',
				),
			],
			away: [
				concert(
					'm3',
					'King Gnu',
					'大阪城ホール',
					'大阪府大阪市',
					new Date('2026-09-15'),
					'18:30',
					'17:30',
					'King Gnu LIVE 2026',
					'',
				),
			],
		},
		{
			label: '9月20日（土）',
			dateKey: '2026-09-20',
			isFirstOfMonth: false,
			monthSeparatorLabel: '',
			home: [
				concert(
					'm4',
					'Official髭男dism',
					'ぴあアリーナMM',
					'神奈川県横浜市',
					new Date('2026-09-20'),
					'17:00',
					'16:00',
					'Official髭男dism one-man live 2026',
					'https://higedan.com',
				),
			],
			nearby: [
				concert(
					'm5',
					'Vaundy',
					'横浜アリーナ',
					'神奈川県横浜市',
					new Date('2026-09-20'),
					'18:00',
					'17:00',
					'Vaundy LIVE TOUR',
					'https://vaundy.jp',
				),
			],
			away: [],
		},
		{
			label: '9月28日（日）',
			dateKey: '2026-09-28',
			isFirstOfMonth: false,
			monthSeparatorLabel: '',
			home: [
				concert(
					'm6',
					'Creepy Nuts',
					'さいたまスーパーアリーナ',
					'埼玉県さいたま市',
					new Date('2026-09-28'),
					'18:00',
					'17:00',
					'Creepy Nuts LIVE TOUR',
					'https://creepynuts.com',
				),
			],
			nearby: [],
			away: [
				concert(
					'm7',
					'Ado',
					'マリンメッセ福岡',
					'福岡県福岡市',
					new Date('2026-09-28'),
					'17:30',
					'16:30',
					'Ado JAPAN TOUR',
					'',
				),
			],
		},
	]
}
