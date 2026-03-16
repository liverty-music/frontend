import './styles/main.css'
import { I18nConfiguration } from '@aurelia/i18n'
import { RouterConfiguration } from '@aurelia/router'
import { StateDefaultConfiguration } from '@aurelia/state'
import Aurelia, {
	ConsoleSink,
	ILogger,
	LoggerConfiguration,
	LogLevel,
} from 'aurelia'
import i18nextBrowserLanguageDetector from 'i18next-browser-languagedetector'
import { AppShell } from './app-shell'
import { BottomNavBar } from './components/bottom-nav-bar/bottom-nav-bar'
import { PageHeader } from './components/page-header/page-header'
import { StatePlaceholder } from './components/state-placeholder/state-placeholder'
import { SvgIcon } from './components/svg-icon/svg-icon'
import { migrateStorageKeys } from './constants/storage-keys'
import { ArtistColorCustomAttribute } from './custom-attributes/artist-color'
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
import { IEntryService } from './services/entry-service'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { IFollowServiceClient } from './services/follow-service-client'
import { GlobalErrorHandlingTask } from './services/global-error-handler'
import { IGuestDataMergeService } from './services/guest-data-merge-service'
import { INotificationManager } from './services/notification-manager'
import { IOnboardingService } from './services/onboarding-service'
import { initOtel } from './services/otel-init'
import { OtelLogSink } from './services/otel-log-sink'
import { IPromptCoordinator } from './services/prompt-coordinator'
import { IProofService } from './services/proof-service'
import { IPushService } from './services/push-service'
import { IPwaInstallService } from './services/pwa-install-service'
import { ITicketService } from './services/ticket-service'
import { UserHydrationTask } from './services/user-hydration-task'
import { IUserService } from './services/user-service'
import { initialState } from './state/app-state'
import {
	createLoggingMiddleware,
	loadPersistedState,
	persistenceMiddleware,
} from './state/middleware'
import { appReducer } from './state/reducer'
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
		level: LogLevel.debug,
		sinks: [ConsoleSink, OtelLogSink],
	}),
)

// Build state middleware list — logging middleware uses ILogger from the container
const stateMiddlewares: {
	middleware: typeof persistenceMiddleware
	placement: 'before' | 'after'
}[] = [{ middleware: persistenceMiddleware, placement: 'after' }]
if (import.meta.env.DEV) {
	const logger = au.container.get(ILogger).scopeTo('Store')
	stateMiddlewares.unshift({
		middleware: createLoggingMiddleware(logger),
		placement: 'before',
	})
}

au.register(
	StateDefaultConfiguration.init(
		{ ...initialState, ...loadPersistedState() },
		{ middlewares: stateMiddlewares },
		appReducer,
	),
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
au.register(IGuestDataMergeService)
au.register(INotificationManager)
au.register(IPushService)
au.register(IPromptCoordinator)
au.register(IPwaInstallService)
au.register(ITicketService)
au.register(IEntryService)
au.register(IProofService)
au.register(BottomNavBar)
au.register(PageHeader)
au.register(StatePlaceholder)
au.register(SvgIcon)
au.register(AuthHook)
au.register(ArtistColorCustomAttribute)
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
