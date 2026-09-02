import './styles/main.css'
import { registerSW } from 'virtual:pwa-register'
import { I18N, I18nConfiguration } from '@aurelia/i18n'
import { RouterConfiguration } from '@aurelia/router'
import Aurelia, {
	ConsoleSink,
	IEventAggregator,
	LoggerConfiguration,
	LogLevel,
	Registration,
} from 'aurelia'
import i18nextBrowserLanguageDetector from 'i18next-browser-languagedetector'
import { onCLS, onINP, onLCP } from 'web-vitals/attribution'
import { IArtistRpcClient } from './adapter/rpc/client/artist-client'
import { IConcertRpcClient } from './adapter/rpc/client/concert-client'
import { IFollowRpcClient } from './adapter/rpc/client/follow-client'
import { IIdentityVerificationRpcClient } from './adapter/rpc/client/identity-verification-client'
import { ILotteryRpcClient } from './adapter/rpc/client/lottery-client'
import { IPushRpcClient } from './adapter/rpc/client/push-client'
import { ITicketJourneyRpcClient } from './adapter/rpc/client/ticket-journey-client'
import { IUserRpcClient } from './adapter/rpc/client/user-client'
import { AppShell } from './app-shell'
import { ArtistFilterBar } from './components/artist-filter-bar/artist-filter-bar'
import { BottomNavBar } from './components/bottom-nav-bar/bottom-nav-bar'
import { BottomSheet } from './components/bottom-sheet/bottom-sheet'
import { CelebrationOverlay } from './components/celebration-overlay/celebration-overlay'
import { InlineError } from './components/inline-error/inline-error'
import { LegalDocument } from './components/legal-document/legal-document'
import { ConcertHighway } from './components/live-highway/concert-highway'
import { EventCard } from './components/live-highway/event-card'
import { EventDetailSheet } from './components/live-highway/event-detail-sheet'
import { LoadingSpinner } from './components/loading-spinner/loading-spinner'
import { NotificationMockCard } from './components/notification-mock/notification-mock-card'
import { PageHeader } from './components/page-header/page-header'
import { PageHelp } from './components/page-help/page-help'
import { PostSignupDialog } from './components/post-signup-dialog/post-signup-dialog'
import { SignupPromptBanner } from './components/signup-prompt-banner/signup-prompt-banner'
import type { SnackHandle } from './components/snack-bar/snack'
import { Snack } from './components/snack-bar/snack'
import { StatePlaceholder } from './components/state-placeholder/state-placeholder'
import { SvgIcon } from './components/svg-icon/svg-icon'
import { Toast } from './components/toast/toast'
import { UserHomeSelector } from './components/user-home-selector/user-home-selector'
import {
	type AppConfig,
	IAppConfig,
	loadAppConfig,
	validateEnvironmentMatchesHost,
} from './config/app-config'
import {
	migrateStorageKeys,
	StorageKeys,
	trackSessionForPrompts,
} from './constants/storage-keys'
import { AmbientGlowCustomAttribute } from './custom-attributes/ambient-glow'
import { ArtistColorCustomAttribute } from './custom-attributes/artist-color'
import { BeamVarsCustomAttribute } from './custom-attributes/beam-vars'
import { BusyOnClickCustomAttribute } from './custom-attributes/busy-on-click'
import { DotColorCustomAttribute } from './custom-attributes/dot-color'
import { SpotlightRadiusCustomAttribute } from './custom-attributes/spotlight-radius'
import { TileColorCustomAttribute } from './custom-attributes/tile-color'
import { AuthHook } from './hooks/auth-hook'
import {
	IAnalyticsService,
	type IAnalyticsService as IAnalyticsServiceType,
} from './lib/analytics/analytics-service'
import { IConsentService } from './lib/consent/consent-service'
import { PUSH_SUBSCRIPTION_CHANGED_MESSAGE } from './lib/push/push-renewal'
import en from './locales/en/translation.json'
import ja from './locales/ja/translation.json'
import { Events } from './services/analytics-events'
import { IArtistBubbleStore } from './services/artist-bubble-store'
import { IArtistStore } from './services/artist-store'
import { IAudioEngine } from './services/audio-engine'
import { IAuthService } from './services/auth-service'
import { ICoachMarkService } from './services/coach-mark-service'
import { IConcertStore } from './services/concert-store'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { FollowReconcileTask } from './services/follow-reconcile-task'
import { IFollowStore } from './services/follow-store'
import { GlobalErrorHandlingTask } from './services/global-error-handler'
import { IIdentityVerificationService } from './services/identity-verification-service'
import { INotificationManager } from './services/notification-manager'
import { IOnboardingService } from './services/onboarding-service'
import { initOtel } from './services/otel-init'
import { OtelLogSink } from './services/otel-log-sink'
import { IPromptCoordinator } from './services/prompt-coordinator'
import { IPushService } from './services/push-service'
import { IPwaInstallService } from './services/pwa-install-service'
import { IResumeRevalidator } from './services/resume-revalidator'
import { IStripeService } from './services/stripe-service'
import { ITicketEmailService } from './services/ticket-email-service'
import { ITicketJourneyService } from './services/ticket-journey-service'
import { ITicketJourneyStore } from './services/ticket-journey-store'
import { UserHydrationTask } from './services/user-hydration-task'
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

function removeBootstrapLoadingIndicator(): void {
	document.getElementById('bootstrap-loading')?.remove()
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
	const config = await loadAppConfig()
	validateEnvironmentMatchesHost(config)

	// Initialize OpenTelemetry with the runtime-resolved API base URL.
	initOtel(config.apiBaseUrl)

	// Migrate legacy localStorage keys (safe to call multiple times)
	migrateStorageKeys()

	// Track session count for notification prompt deferral logic
	trackSessionForPrompts()

	const au = new Aurelia()

	// AppConfig must be registered first so any later DI resolution
	// (services constructed during Aurelia.start) can resolve it.
	au.register(Registration.instance(IAppConfig, config))

	au.register(
		I18nConfiguration.customize((options) => {
			options.initOptions = {
				// Load-bearing: `@aurelia/i18n` injects a default `lng: 'en'` into the
				// i18next init options, and i18next treats an explicit `lng` as an
				// override that BYPASSES the language detector entirely. Setting it
				// back to `undefined` re-enables the `detection` chain below, so the
				// boot locale is resolved from querystring → localStorage → navigator
				// (honoring the migrated `language` key) instead of being hard-pinned
				// to English. Do NOT delete this as a no-op — its absence silently
				// disables detection and the app always boots English.
				lng: undefined,
				resources: {
					ja: { translation: ja },
					en: { translation: en },
				},
				fallbackLng: 'ja',
				supportedLngs: ['ja', 'en'],
				interpolation: { escapeValue: false },
				detection: {
					order: ['querystring', 'localStorage', 'navigator'],
					lookupQuerystring: 'lang',
					lookupLocalStorage: StorageKeys.language,
					// Persist the detected locale to localStorage so anonymous reloads
					// see a stable language without re-detecting from navigator each
					// time. After signup, the DB becomes the source of truth and
					// hydration removes this key (see UserHydrationTask).
					caches: ['localStorage'],
				},
				plugins: [i18nextBrowserLanguageDetector],
			}
		}),
	)
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
	au.register(UserHydrationTask)
	au.register(IArtistStore)
	au.register(IArtistBubbleStore)
	au.register(IConcertStore)
	au.register(IOnboardingService)
	au.register(ICoachMarkService)
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
	au.register(IAudioEngine)
	au.register(INotificationManager)
	au.register(IPushService)
	au.register(IPromptCoordinator)
	au.register(IPwaInstallService)
	au.register(ITicketJourneyService)
	au.register(ITicketJourneyStore)
	au.register(IIdentityVerificationService)
	au.register(IResumeRevalidator)
	au.register(ITicketEmailService)
	au.register(IArtistRpcClient)
	au.register(IConcertRpcClient)
	au.register(IFollowRpcClient)
	au.register(ITicketJourneyRpcClient)
	au.register(IUserRpcClient)
	au.register(IPushRpcClient)
	au.register(IIdentityVerificationRpcClient)
	au.register(ILotteryRpcClient)
	au.register(IStripeService)
	au.register(ArtistFilterBar)
	au.register(BottomNavBar)
	au.register(BottomSheet)
	au.register(CelebrationOverlay)
	au.register(ConcertHighway)
	au.register(EventCard)
	au.register(EventDetailSheet)
	au.register(InlineError)
	au.register(NotificationMockCard)
	au.register(LegalDocument)
	au.register(LoadingSpinner)
	au.register(SignupPromptBanner)
	au.register(Toast)
	au.register(PageHeader)
	au.register(PageHelp)
	au.register(PostSignupDialog)
	au.register(StatePlaceholder)
	au.register(SvgIcon)
	au.register(UserHomeSelector)
	au.register(AuthHook)
	au.register(AmbientGlowCustomAttribute)
	au.register(ArtistColorCustomAttribute)
	au.register(BusyOnClickCustomAttribute)
	au.register(BeamVarsCustomAttribute)
	au.register(DotColorCustomAttribute)
	au.register(SpotlightRadiusCustomAttribute)
	au.register(TileColorCustomAttribute)
	au.register(DateValueConverter)
	au.app(AppShell)
	await au.start()

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

	// Remove the inline loading indicator now that Aurelia has rendered.
	removeBootstrapLoadingIndicator()

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
			void pushService.resolvePushState(userStore.current?.id ?? undefined)
		}
		recoverPush()
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
		) => {
			ea.publish(
				new Snack(message, severity as 'info' | 'warning' | 'error', {
					duration: durationMs,
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

	// Long Animation Frames — frames ≥ 100ms (50–99ms intentionally excluded to limit volume)
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (entry.duration < 100) continue
				const loaf = entry as PerformanceLongAnimationFrameTiming
				const topScript = loaf.scripts?.[0]
				analytics.capture(Events.LongAnimationFrame, {
					duration_ms: Math.round(entry.duration),
					top_function: topScript?.sourceFunctionName ?? '',
					top_script: topScript?.sourceURL ?? '',
					route: route(),
				})
			}
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
