import './styles/main.css'
import { I18nConfiguration } from '@aurelia/i18n'
import { RouterConfiguration } from '@aurelia/router'
import Aurelia, { ConsoleSink, LoggerConfiguration, LogLevel } from 'aurelia'
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
import { BottomNavBar } from './components/bottom-nav-bar/bottom-nav-bar'
import { BottomSheet } from './components/bottom-sheet/bottom-sheet'
import { LoadingSpinner } from './components/loading-spinner/loading-spinner'
import { PageHeader } from './components/page-header/page-header'
import { StatePlaceholder } from './components/state-placeholder/state-placeholder'
import { SvgIcon } from './components/svg-icon/svg-icon'
import { Toast } from './components/toast/toast'
import { migrateStorageKeys } from './constants/storage-keys'
import { ArtistColorCustomAttribute } from './custom-attributes/artist-color'
import { BeamVarsCustomAttribute } from './custom-attributes/beam-vars'
import { DotColorCustomAttribute } from './custom-attributes/dot-color'
import { SpotlightRadiusCustomAttribute } from './custom-attributes/spotlight-radius'
import { TileColorCustomAttribute } from './custom-attributes/tile-color'
import { AuthHook } from './hooks/auth-hook'
import en from './locales/en/translation.json'
import ja from './locales/ja/translation.json'
import { IArtistServiceClient } from './services/artist-service-client'
import { IAuthService } from './services/auth-service'
import { IConcertService } from './services/concert-service'
import { IDashboardService } from './services/dashboard-service'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { IFollowServiceClient } from './services/follow-service-client'
import { GlobalErrorHandlingTask } from './services/global-error-handler'
import { IGuestDataMergeService } from './services/guest-data-merge-service'
import { IGuestService } from './services/guest-service'
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

// Initialize OpenTelemetry before Aurelia startup
initOtel()

// Migrate legacy localStorage keys (safe to call multiple times)
migrateStorageKeys()

// Css files imported in this main file should be imported with ?inline query
// to get CSS as string for sharedStyles in shadowDOM.
// import shared from './shared.css?inline';

const au = new Aurelia()

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
				lookupLocalStorage: 'language',
				caches: [],
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
		level: import.meta.env.DEV ? LogLevel.debug : LogLevel.warn,
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
au.register(IDashboardService)
au.register(IOnboardingService)
au.register(IGuestService)
au.register(IGuestDataMergeService)
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
au.register(BottomNavBar)
au.register(BottomSheet)
au.register(LoadingSpinner)
au.register(Toast)
au.register(PageHeader)
au.register(StatePlaceholder)
au.register(SvgIcon)
au.register(AuthHook)
au.register(ArtistColorCustomAttribute)
au.register(BeamVarsCustomAttribute)
au.register(DotColorCustomAttribute)
au.register(SpotlightRadiusCustomAttribute)
au.register(TileColorCustomAttribute)
au.register(DateValueConverter)
au.app(AppShell)
au.start()

// Register Service Worker for push notifications (production only).
// In dev mode, vite-plugin-node-polyfills injects Buffer/global/process shims
// into the SW bundle, which breaks ServiceWorker evaluation.
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
	navigator.serviceWorker.register('/sw.js').catch((err) => {
		console.warn('Service Worker registration failed:', err)
	})
}
