import './styles/main.css'
import { registerSW } from 'virtual:pwa-register'
import { I18N } from '@aurelia/i18n'
import { RouterConfiguration } from '@aurelia/router'
import Aurelia, {
	AppTask,
	ConsoleSink,
	IEventAggregator,
	LoggerConfiguration,
	LogLevel,
	Registration,
} from 'aurelia'
import { onCLS, onINP, onLCP } from 'web-vitals/attribution'
import type { SnackHandle } from '../shared/ui/snack-bar/snack'
import { Snack } from '../shared/ui/snack-bar/snack'
import { IArtistRpcClient } from './adapter/rpc/client/artist-client'
import { IConcertRpcClient } from './adapter/rpc/client/concert-client'
import { IFollowRpcClient } from './adapter/rpc/client/follow-client'
import { IIdentityVerificationRpcClient } from './adapter/rpc/client/identity-verification-client'
import { ILotteryEntryRpcClient } from './adapter/rpc/client/lottery-entry-client'
import { IPushSubscriptionRpcClient } from './adapter/rpc/client/push-subscription-client'
import { ITicketJourneyRpcClient } from './adapter/rpc/client/ticket-journey-client'
import { IUserRpcClient } from './adapter/rpc/client/user-client'
import { AppShell } from './app-shell'
import { ArtistFilterBar } from './components/artist-filter-bar/artist-filter-bar'
import { BottomNavBar } from './components/bottom-nav-bar/bottom-nav-bar'
import { BottomSheet } from './components/bottom-sheet/bottom-sheet'
import { CelebrationOverlay } from './components/celebration-overlay/celebration-overlay'
import { FabMenu } from './components/fab-menu/fab-menu'
import { InlineError } from './components/inline-error/inline-error'
import { LegalDocument } from './components/legal-document/legal-document'
import { ConcertHighway } from './components/live-highway/concert-highway'
import { EventCard } from './components/live-highway/event-card'
import { EventDetailSheet } from './components/live-highway/event-detail-sheet'
import { NotificationMockCard } from './components/notification-mock/notification-mock-card'
import { PageHeader } from './components/page-header/page-header'
import { PageHelp } from './components/page-help/page-help'
import { PostSignupDialog } from './components/post-signup-dialog/post-signup-dialog'
import { SettingsConsentRow } from './components/settings-consent-row/settings-consent-row'
import { SettingsLinkRow } from './components/settings-link-row/settings-link-row'
import { SettingsStatusRow } from './components/settings-status-row/settings-status-row'
import { SettingsSwitchRow } from './components/settings-switch-row/settings-switch-row'
import { SignupPromptBanner } from './components/signup-prompt-banner/signup-prompt-banner'
import { StatePlaceholder } from './components/state-placeholder/state-placeholder'
import { SuccessMark } from './components/success-mark/success-mark'
import { SvgIcon } from './components/svg-icon/svg-icon'
import { Toast } from './components/toast/toast'
import { UserHomeSelector } from './components/user-home-selector/user-home-selector'
import {
	type AppConfig,
	IAppConfig,
	loadAppConfig,
	validateEnvironmentMatchesHost,
} from './config/app-config'
import { AmbientGlowCustomAttribute } from './custom-attributes/ambient-glow'
import { BeamVarsCustomAttribute } from './custom-attributes/beam-vars'
import { BusyOnClickCustomAttribute } from './custom-attributes/busy-on-click'
import { DotColorCustomAttribute } from './custom-attributes/dot-color'
import { TileColorCustomAttribute } from './custom-attributes/tile-color'
import { AuthHook } from './hooks/auth-hook'
import {
	IAnalyticsService,
	type IAnalyticsService as IAnalyticsServiceType,
} from './lib/analytics/analytics-service'
import {
	createLongFrameReporter,
	type LongFrameEntry,
} from './lib/analytics/long-frame-reporter'
import { IConsentService } from './lib/consent/consent-service'
import { FanI18nConfiguration } from './lib/i18n/fan-i18n-configuration'
import { PUSH_SUBSCRIPTION_CHANGED_MESSAGE } from './lib/push/push-renewal'
import { Events } from './services/analytics-events'
import { IArtistBubbleStore } from './services/artist-bubble-store'
import { IArtistStore } from './services/artist-store'
import { IAudioEngine } from './services/audio-engine'
import { IAuthService } from './services/auth-service'
import { IConcertStore } from './services/concert-store'
import { DiscoveryPrefetchTask } from './services/discovery-prefetch-task'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { IFabMenuService } from './services/fab-menu-service'
import { FollowPrefetchTask } from './services/follow-prefetch-task'
import { FollowReconcileTask } from './services/follow-reconcile-task'
import { IFollowStore } from './services/follow-store'
import { GlobalErrorHandlingTask } from './services/global-error-handler'
import { IHapticService } from './services/haptic-service'
import { IIdentityVerificationService } from './services/identity-verification-service'
import { INotificationManager } from './services/notification-manager'
import { IOnboardingService } from './services/onboarding-service'
import { initOtel } from './services/otel-init'
import { OtelLogSink } from './services/otel-log-sink'
import { IPromptCoordinator } from './services/prompt-coordinator'
import { IPushService } from './services/push-service'
import { IPwaInstallService } from './services/pwa-install-service'
import { IResumeRevalidator } from './services/resume-revalidator'
import { IRpcTelemetry } from './services/rpc-telemetry-service'
import { IStripeService } from './services/stripe-service'
import { ITicketJourneyService } from './services/ticket-journey-service'
import { ITicketJourneyStore } from './services/ticket-journey-store'
import { ITicketWallet } from './services/ticket-wallet'
import {
	IUserHydration,
	UserHydrationTask,
} from './services/user-hydration-task'
import { IUserStore } from './services/user-store'
import { DateValueConverter } from './value-converters/date'

// Stored after Aurelia.start() so the PWA update toast can publish via EA + I18N.
let _pwaEa: IEventAggregator | null = null
let _pwaI18n: I18N | null = null
// Set to true if onNeedRefresh fires before bootstrap() completes (EA/I18N not
// yet available). bootstrap() flushes it via _showUpdateToast after au.start().
let _pendingRefresh = false
let _showUpdateToast: (() => void) | null = null

function resolveLogLevel(configLogLevel: AppConfig['logLevel']): LogLevel {
	const map: Record<AppConfig['logLevel'], LogLevel> = {
		trace: LogLevel.trace,
		debug: LogLevel.debug,
		info: LogLevel.info,
		warn: LogLevel.warn,
		error: LogLevel.error,
	}
	return map[configLogLevel]
}

function showStaticErrorPage(err: unknown): void {
	const message = err instanceof Error ? err.message : String(err)
	const detail = import.meta.env.DEV ? `<pre>${escapeHtml(message)}</pre>` : ''
	document.body.innerHTML = `
		<main style="font-family:system-ui;max-width:42rem;margin:4rem auto;padding:0 1rem;color:#222">
			<h1 style="font-size:1.5rem;margin:0 0 1rem">App failed to start</h1>
			<p>The application could not initialize. Please try reloading the page. If the problem persists, contact support.</p>
			${detail}
		</main>
	`.trim()
	console.error('Bootstrap failure:', err)
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

async function bootstrap(): Promise<void> {
	// The sign-in callback renders nothing until canLoad finishes the sign-in;
	// show the static indicator from index.html for that wait.
	const callbackLoading = document.getElementById('callback-loading')
	if (
		window.location.pathname === '/auth/callback' ||
		window.location.pathname === '/auth/passkeys-callback'
	) {
		callbackLoading?.removeAttribute('hidden')
	}
	const config = await loadAppConfig()
	validateEnvironmentMatchesHost(config)

	// Initialize OpenTelemetry with the runtime-resolved API base URL.
	initOtel(config.apiBaseUrl)

	const au = new Aurelia()

	// AppConfig must be registered first so any later DI resolution
	// (services constructed during Aurelia.start) can resolve it.
	au.register(Registration.instance(IAppConfig, config))

	au.register(FanI18nConfiguration)
	au.register(
		RouterConfiguration.customize({
			restorePreviousRouteTreeOnError: !import.meta.env.DEV,
		}),
	)
	au.register(
		LoggerConfiguration.create({
			level: resolveLogLevel(config.logLevel),
			sinks: [ConsoleSink, OtelLogSink],
		}),
	)

	au.register(IErrorBoundaryService)
	au.register(GlobalErrorHandlingTask)
	au.register(IAuthService)
	// Consent + analytics registered together immediately after the user
	// service: AnalyticsService depends on IConsentService for its
	// identify-gating, and the Batch 3b consent-screen flow will mount
	// once the user is hydrated. Page-view emission (subscribed in
	// AppShell) starts the moment Aurelia.start() resolves, so both
	// registrations MUST be in place before app() is called below.
	au.register(IConsentService)
	au.register(IAnalyticsService)
	// RPC telemetry records client-observed call durations/outcomes through the
	// shared transport and flushes aggregates via AnalyticsService — register it
	// after analytics/consent so its opt-out / nil-config gate resolves. The
	// `creating` AppTask constructs the singleton at boot so it installs the
	// transport recording sink before any RPC client is used.
	au.register(IRpcTelemetry)
	au.register(AppTask.creating(IRpcTelemetry, () => undefined))
	// The ticket wallet keeps the device key pair and the last tickets list in
	// IndexedDB and removes both on SignedOut; construct it at boot so that
	// subscription is live even when the tickets screen was never opened.
	au.register(AppTask.creating(ITicketWallet, () => undefined))
	au.register(UserHydrationTask)
	au.register(IArtistStore)
	au.register(IArtistBubbleStore)
	au.register(IConcertStore)
	au.register(IOnboardingService)
	// UserStore is the single owner of the User entity: it owns the guest
	// home/language slice directly (hydrated from the guest-storage adapter) AND
	// the authenticated User entity (cache→Get→Create chain + write-through
	// updates, absorbed from the former UserService). Callers read the store
	// instead of branching on auth state.
	au.register(IUserStore)
	// FollowStore is the single owner of the follow slice: the optimistic
	// follow/unfollow/setHype facade + @observable projection, the persisted
	// guest follow queue, and the auth-boundary transitions
	// (GuestMigrationRequested → migrate, SignedOut → self-clear + cache eviction).
	au.register(IFollowStore)
	// FollowReconcileTask is an activating AppTask that heals partial follow
	// migrations on boot, keyed on the per-account guest-merge receipt. Same-slot
	// AppTasks (this and UserHydrationTask) run CONCURRENTLY via Promise.all, NOT
	// sequentially in registration order, so this task does NOT depend on
	// UserHydrationTask having populated `UserStore.current` first — it calls
	// the idempotent `ensureLoaded` itself before reading `current.id`. It also
	// eagerly resolves IFollowStore so its event subscriptions are live before
	// any sign-up / sign-out fires.
	au.register(FollowReconcileTask)
	// Loads the signed-in follow list in the background once the session is
	// known (does not block start-up), so Discovery can pick its seeds without
	// waiting a round trip.
	au.register(FollowPrefetchTask)
	// For an app opened on Discovery, starts building the bubble field during
	// start-up (after the follow list for a signed-in fan); does not block.
	au.register(DiscoveryPrefetchTask)
	au.register(IAudioEngine)
	au.register(IHapticService)
	au.register(INotificationManager)
	au.register(IPushService)
	au.register(IPromptCoordinator)
	au.register(IPwaInstallService)
	au.register(ITicketJourneyService)
	au.register(ITicketJourneyStore)
	au.register(IIdentityVerificationService)
	au.register(IResumeRevalidator)
	au.register(IFabMenuService)
	au.register(IArtistRpcClient)
	au.register(IConcertRpcClient)
	au.register(IFollowRpcClient)
	au.register(ITicketJourneyRpcClient)
	au.register(IUserRpcClient)
	au.register(IPushSubscriptionRpcClient)
	au.register(IIdentityVerificationRpcClient)
	au.register(ILotteryEntryRpcClient)
	au.register(IStripeService)
	au.register(ArtistFilterBar)
	au.register(BottomNavBar)
	au.register(BottomSheet)
	au.register(CelebrationOverlay)
	au.register(ConcertHighway)
	au.register(EventCard)
	au.register(EventDetailSheet)
	au.register(FabMenu)
	au.register(InlineError)
	au.register(NotificationMockCard)
	au.register(LegalDocument)
	au.register(SignupPromptBanner)
	au.register(Toast)
	au.register(PageHeader)
	au.register(PageHelp)
	au.register(PostSignupDialog)
	au.register(StatePlaceholder)
	au.register(SuccessMark)
	au.register(
		SettingsConsentRow,
		SettingsLinkRow,
		SettingsStatusRow,
		SettingsSwitchRow,
	)
	au.register(SvgIcon)
	au.register(UserHomeSelector)
	au.register(AuthHook)
	au.register(AmbientGlowCustomAttribute)
	au.register(BusyOnClickCustomAttribute)
	au.register(BeamVarsCustomAttribute)
	au.register(DotColorCustomAttribute)
	au.register(TileColorCustomAttribute)
	au.register(DateValueConverter)
	au.app(AppShell)
	await au.start()
	callbackLoading?.remove()

	// Store EA + I18N so the PWA onNeedRefresh callback can publish the update toast.
	_pwaEa = au.container.get(IEventAggregator)
	_pwaI18n = au.container.get(I18N)

	// Register performance observers. All three send to PostHog via the same
	// IAnalyticsService that handles consent opt-out suppression internally.
	registerPerfObservers(au.container.get(IAnalyticsService))
	// Flush any SW update notification that arrived before bootstrap completed.
	if (_pendingRefresh) {
		_showUpdateToast?.()
		_pendingRefresh = false
	}

	// Push subscription recovery. On app open, reconcile the browser⇄backend
	// push subscription so a permission-granted user whose subscription lapsed
	// (410 cleanup, PWA reinstall, data clear) is auto re-subscribed instead of
	// left silently OFF — the primary safety net for the 2026-08 silent outage.
	// resolvePushState is permission-gated (returns immediately when permission
	// is not `granted`), so this is cheap and never prompts. It also handles the
	// SW `pushsubscriptionchange` signal, which the SW forwards to open clients
	// because it cannot call the authenticated Create RPC itself.
	{
		const pushService = au.container.get(IPushService)
		const userStore = au.container.get(IUserStore)
		const recoverPush = (): void => {
			void pushService.resolvePushState(userStore.current !== undefined)
		}
		// Wait for the user: the first render does not when the app opens on
		// Discovery, and recovery needs to know whether someone is signed in.
		void au.container.get(IUserHydration).ready.then(recoverPush)
		navigator.serviceWorker?.addEventListener('message', (event) => {
			if (event.data?.type === PUSH_SUBSCRIPTION_CHANGED_MESSAGE) {
				recoverPush()
			}
		})
	}

	// Test-only bridge: expose EA publish for snack-bar E2E tests.
	// This allows Playwright to trigger real snack toasts without needing
	// to access Aurelia internals. Stripped by tree-shaking in production
	// builds because the reference is guarded by the dev env check.
	if (import.meta.env.DEV) {
		const ea = au.container.get(IEventAggregator)
		;(window as unknown as Record<string, unknown>).__lm_publishSnack = (
			message: string,
			severity: string,
			durationMs: number,
			options?: {
				icon?: string | null
				attention?: boolean
				actionLabel?: string
			},
		) => {
			ea.publish(
				new Snack(message, severity as 'info' | 'warning' | 'error', {
					duration: durationMs,
					icon: options?.icon,
					attention: options?.attention,
					action: options?.actionLabel
						? { label: options.actionLabel, callback: () => {} }
						: undefined,
				}),
			)
		}
	}
}

bootstrap().catch(showStaticErrorPage)

// Register Service Worker via virtual:pwa-register (production only).
// virtual:pwa-register handles updatefound → statechange → controllerchange →
// single-shot location.reload() internally, so NO manual controllerchange
// listener should be added here (double-reload risk per design D1).
if (!import.meta.env.DEV) {
	// Active update Snack handle — non-null while a toast is showing. Used to
	// dismiss and replace before publishing a second onNeedRefresh toast.
	let activeUpdateSnackHandle: SnackHandle | null = null

	const showUpdateToast = () => {
		if (!_pwaEa || !_pwaI18n) return
		if (activeUpdateSnackHandle !== null) {
			activeUpdateSnackHandle.dismiss()
			activeUpdateSnackHandle = null
		}
		const snack = new Snack(_pwaI18n.tr('pwa.updateAvailable'), 'info', {
			duration: Infinity,
			icon: null,
			attention: true,
			action: {
				label: _pwaI18n.tr('pwa.updateAction'),
				callback: () => updateSW(true),
			},
		})
		_pwaEa.publish(snack)
		activeUpdateSnackHandle = snack.handle
	}
	_showUpdateToast = showUpdateToast

	const updateSW = registerSW({
		onNeedRefresh() {
			if (!_pwaEa || !_pwaI18n) {
				// Bootstrap not yet complete — defer until after au.start().
				_pendingRefresh = true
				return
			}
			showUpdateToast()
		},
		onRegisteredSW(_url, registration) {
			if (!registration) return
			registration.update()
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'visible') {
					registration.update()
				}
			})
		},
	})
}

/** Cap on `perf.long_animation_frame` events per page load. */
const LONG_FRAME_EVENTS_PER_PAGE = 20

/**
 * Register performance observers that send real-user metrics to PostHog.
 * Registered once after Aurelia bootstraps; active for the whole session.
 * IAnalyticsService handles consent opt-out suppression internally so
 * observers can always call capture() without extra gating here.
 */
function registerPerfObservers(analytics: IAnalyticsServiceType): void {
	const route = (): string => window.location.pathname

	// Core Web Vitals (web-vitals/attribution) — LCP, INP, CLS
	const sendVital = (metric: {
		name: string
		value: number
		rating: string
		navigationType?: string
	}): void => {
		if (metric.name !== 'LCP' && metric.name !== 'INP' && metric.name !== 'CLS')
			return
		analytics.capture(Events.WebVitals, {
			name: metric.name as 'LCP' | 'INP' | 'CLS',
			value: Math.round(metric.value),
			rating: metric.rating as 'good' | 'needs-improvement' | 'poor',
			navigation_type: metric.navigationType ?? 'unknown',
			route: route(),
		})
	}
	onLCP(sendVital)
	onINP(sendVital)
	onCLS(sendVital)

	if (!('PerformanceObserver' in window)) return

	// Long Animation Frames — at most LONG_FRAME_EVENTS_PER_PAGE per page load.
	const reportLongFrames = createLongFrameReporter(
		(props) => analytics.capture(Events.LongAnimationFrame, props),
		route,
		LONG_FRAME_EVENTS_PER_PAGE,
	)
	try {
		new PerformanceObserver((list) => {
			reportLongFrames(list.getEntries() as unknown as LongFrameEntry[])
		}).observe({ type: 'long-animation-frame', buffered: true })
	} catch {
		// long-animation-frame not supported in this browser
	}

	// Slow interactions — processing duration ≥ 150ms.
	// Register without durationThreshold (browser minimum 104ms applies);
	// the 150ms cutoff is applied in the callback to avoid missing 104–149ms events.
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (entry.duration < 150) continue
				analytics.capture(Events.SlowInteraction, {
					interaction_type: entry.name,
					duration_ms: Math.round(entry.duration),
					route: route(),
				})
			}
		}).observe({ type: 'event', buffered: true })
	} catch {
		// event timing not supported in this browser
	}
}
