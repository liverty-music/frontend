import { I18nConfiguration } from '@aurelia/i18n'
import { RouterConfiguration } from '@aurelia/router'
import Aurelia, { ConsoleSink, LoggerConfiguration, LogLevel } from 'aurelia'
import i18nextBrowserLanguageDetector from 'i18next-browser-languagedetector'
import { BottomNavBar } from './components/bottom-nav-bar/bottom-nav-bar'
import { migrateStorageKeys } from './constants/storage-keys'
import { AuthHook } from './hooks/auth-hook'
import en from './locales/en/translation.json'
import ja from './locales/ja/translation.json'
import { MyApp } from './my-app'
import { IArtistServiceClient } from './services/artist-service-client'
import { IAuthService } from './services/auth-service'
import { IConcertService } from './services/concert-service'
import { IDashboardService } from './services/dashboard-service'
import { IEntryService } from './services/entry-service'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { GlobalErrorHandlingTask } from './services/global-error-handler'
import { IGuestDataMergeService } from './services/guest-data-merge-service'
import { ILocalArtistClient } from './services/local-artist-client'
import { INotificationManager } from './services/notification-manager'
import { IOnboardingService } from './services/onboarding-service'
import { initOtel } from './services/otel-init'
import { OtelLogSink } from './services/otel-log-sink'
import { IPromptCoordinator } from './services/prompt-coordinator'
import { IProofService } from './services/proof-service'
import { IPushService } from './services/push-service'
import { IPwaInstallService } from './services/pwa-install-service'
import { ITicketService } from './services/ticket-service'
import { IUserService } from './services/user-service'
import { DateValueConverter } from './value-converters/date'

// Initialize OpenTelemetry before Aurelia startup
initOtel()

// Migrate legacy localStorage keys (safe to call multiple times)
migrateStorageKeys()

// Css files imported in this main file should be imported with ?inline query
// to get CSS as string for sharedStyles in shadowDOM.
// import shared from './shared.css?inline';

Aurelia
	/*
  .register(StyleConfiguration.shadowDOM({
    // optionally add the shared styles for all components
    sharedStyles: [shared]
  }))
  */
	.register(
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
	.register(
		RouterConfiguration.customize({
			restorePreviousRouteTreeOnError: !import.meta.env.DEV,
		}),
	)
	.register(
		LoggerConfiguration.create({
			level: LogLevel.debug,
			sinks: [ConsoleSink, OtelLogSink],
		}),
	)
	.register(IErrorBoundaryService)
	.register(GlobalErrorHandlingTask)
	.register(IAuthService)
	.register(IUserService)
	.register(IArtistServiceClient)
	.register(IConcertService)
	.register(IDashboardService)
	.register(IOnboardingService)
	.register(ILocalArtistClient)
	.register(IGuestDataMergeService)
	.register(INotificationManager)
	.register(IPushService)
	.register(IPromptCoordinator)
	.register(IPwaInstallService)
	.register(ITicketService)
	.register(IEntryService)
	.register(IProofService)
	.register(BottomNavBar)
	.register(AuthHook)
	.register(DateValueConverter)
	// To use HTML5 pushState routes, replace previous line with the following
	// customized router config.
	// .register(RouterConfiguration.customize({ useUrlFragmentHash: false }))
	.app(MyApp)
	.start()

// Register Service Worker for push notifications (production only).
// In dev mode, vite-plugin-node-polyfills injects Buffer/global/process shims
// into the SW bundle, which breaks ServiceWorker evaluation.
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
	navigator.serviceWorker.register('/sw.js').catch((err) => {
		console.warn('Service Worker registration failed:', err)
	})
}
