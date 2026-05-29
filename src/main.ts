import './styles/main.css'
import { I18nConfiguration } from '@aurelia/i18n'
import { RouterConfiguration } from '@aurelia/router'
import Aurelia, {
	ConsoleSink,
	IEventAggregator,
	LoggerConfiguration,
	LogLevel,
	Registration,
} from 'aurelia'
import i18nextBrowserLanguageDetector from 'i18next-browser-languagedetector'
import { IArtistRpcClient } from './adapter/rpc/client/artist-client'
import { IConcertRpcClient } from './adapter/rpc/client/concert-client'
import { IEntryRpcClient } from './adapter/rpc/client/entry-client'
import { IFollowRpcClient } from './adapter/rpc/client/follow-client'
import { IPushRpcClient } from './adapter/rpc/client/push-client'
import { ITicketRpcClient } from './adapter/rpc/client/ticket-client'
import { ITicketJourneyRpcClient } from './adapter/rpc/client/ticket-journey-client'
import { IUserRpcClient } from './adapter/rpc/client/user-client'
import { AppShell } from './app-shell'
import { ArtistFilterBar } from './components/artist-filter-bar/artist-filter-bar'
import { ArtistUnfollowSheet } from './components/artist-unfollow-sheet/artist-unfollow-sheet'
import { BottomNavBar } from './components/bottom-nav-bar/bottom-nav-bar'
import { BottomSheet } from './components/bottom-sheet/bottom-sheet'
import { CelebrationOverlay } from './components/celebration-overlay/celebration-overlay'
import { IAudioEngine } from './components/dna-orb/audio-engine'
import { InlineError } from './components/inline-error/inline-error'
import { ConcertHighway } from './components/live-highway/concert-highway'
import { EventCard } from './components/live-highway/event-card'
import { EventDetailSheet } from './components/live-highway/event-detail-sheet'
import { LoadingSpinner } from './components/loading-spinner/loading-spinner'
import { PageHeader } from './components/page-header/page-header'
import { PageHelp } from './components/page-help/page-help'
import { PostSignupDialog } from './components/post-signup-dialog/post-signup-dialog'
import { SignupPromptBanner } from './components/signup-prompt-banner/signup-prompt-banner'
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
import { ArtistColorCustomAttribute } from './custom-attributes/artist-color'
import { BeamVarsCustomAttribute } from './custom-attributes/beam-vars'
import { DotColorCustomAttribute } from './custom-attributes/dot-color'
import { LongPressCustomAttribute } from './custom-attributes/long-press'
import { SpotlightRadiusCustomAttribute } from './custom-attributes/spotlight-radius'
import { TileColorCustomAttribute } from './custom-attributes/tile-color'
import { AuthHook } from './hooks/auth-hook'
import en from './locales/en/translation.json'
import ja from './locales/ja/translation.json'
import { IArtistServiceClient } from './services/artist-service-client'
import { IAuthService } from './services/auth-service'
import { IConcertService } from './services/concert-service'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { IFollowServiceClient } from './services/follow-service-client'
import { GlobalErrorHandlingTask } from './services/global-error-handler'
import { IGuestDataMergeService } from './services/guest-data-merge-service'
import { IGuestService } from './services/guest-service'
import { INavDimmingService } from './services/nav-dimming-service'
import { INotificationManager } from './services/notification-manager'
import { IOnboardingService } from './services/onboarding-service'
import { initOtel } from './services/otel-init'
import { OtelLogSink } from './services/otel-log-sink'
import { IPromptCoordinator } from './services/prompt-coordinator'
import { IProofService } from './services/proof-service'
import { IPushService } from './services/push-service'
import { IPwaInstallService } from './services/pwa-install-service'
import { ITicketEmailService } from './services/ticket-email-service'
import { ITicketJourneyService } from './services/ticket-journey-service'
import { UserHydrationTask } from './services/user-hydration-task'
import { IUserService } from './services/user-service'
import { DateValueConverter } from './value-converters/date'

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
	au.register(IUserService)
	au.register(UserHydrationTask)
	au.register(IArtistServiceClient)
	au.register(IFollowServiceClient)
	au.register(IConcertService)
	au.register(IOnboardingService)
	au.register(IGuestService)
	au.register(IGuestDataMergeService)
	au.register(INavDimmingService)
	au.register(IAudioEngine)
	au.register(INotificationManager)
	au.register(IPushService)
	au.register(IPromptCoordinator)
	au.register(IPwaInstallService)
	au.register(ITicketJourneyService)
	au.register(ITicketEmailService)
	au.register(IArtistRpcClient)
	au.register(IConcertRpcClient)
	au.register(IFollowRpcClient)
	au.register(ITicketRpcClient)
	au.register(ITicketJourneyRpcClient)
	au.register(IEntryRpcClient)
	au.register(IUserRpcClient)
	au.register(IPushRpcClient)
	au.register(IProofService)
	au.register(ArtistUnfollowSheet)
	au.register(ArtistFilterBar)
	au.register(BottomNavBar)
	au.register(BottomSheet)
	au.register(CelebrationOverlay)
	au.register(ConcertHighway)
	au.register(EventCard)
	au.register(EventDetailSheet)
	au.register(InlineError)
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
	au.register(ArtistColorCustomAttribute)
	au.register(LongPressCustomAttribute)
	au.register(BeamVarsCustomAttribute)
	au.register(DotColorCustomAttribute)
	au.register(SpotlightRadiusCustomAttribute)
	au.register(TileColorCustomAttribute)
	au.register(DateValueConverter)
	au.app(AppShell)
	await au.start()

	// Remove the inline loading indicator now that Aurelia has rendered.
	removeBootstrapLoadingIndicator()

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

// Register Service Worker for push notifications (production only).
// In dev mode, vite-plugin-node-polyfills injects Buffer/global/process shims
// into the SW bundle, which breaks ServiceWorker evaluation.
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
	navigator.serviceWorker.register('/sw.js').catch((err) => {
		console.warn('Service Worker registration failed:', err)
	})
}
