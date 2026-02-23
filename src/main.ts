import { RouterConfiguration } from '@aurelia/router'
import Aurelia, {
	ConsoleSink,
	ILogger,
	LoggerConfiguration,
	LogLevel,
} from 'aurelia'
import { BottomNavBar } from './components/bottom-nav-bar/bottom-nav-bar'
import { IToastService } from './components/toast-notification/toast-notification'
import { AuthHook } from './hooks/auth-hook'
import { MyApp } from './my-app'
import { IArtistDiscoveryService } from './services/artist-discovery-service'
import { IArtistServiceClient } from './services/artist-service-client'
import { IAuthService } from './services/auth-service'
import { IConcertService } from './services/concert-service'
import { IDashboardService } from './services/dashboard-service'
import { IEntryService } from './services/entry-service'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { GlobalErrorHandlingTask } from './services/global-error-handler'
import { INotificationManager } from './services/notification-manager'
import { initOtel } from './services/otel-init'
import { OtelLogSink } from './services/otel-log-sink'
import { IProofService } from './services/proof-service'
import { IPushService } from './services/push-service'
import { ITicketService } from './services/ticket-service'
import { IUserService } from './services/user-service'

// Initialize OpenTelemetry before Aurelia startup
initOtel()

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
	.register(IArtistDiscoveryService)
	.register(IDashboardService)
	.register(INotificationManager)
	.register(IPushService)
	.register(ITicketService)
	.register(IEntryService)
	.register(IProofService)
	.register(IToastService)
	.register(BottomNavBar)
	.register(AuthHook)
	// To use HTML5 pushState routes, replace previous line with the following
	// customized router config.
	// .register(RouterConfiguration.customize({ useUrlFragmentHash: false }))
	.app(MyApp)
	.start()
	.then((au) => {
		// Register Service Worker for push notifications after Aurelia bootstrap
		if ('serviceWorker' in navigator) {
			const logger = au.container.get(ILogger).scopeTo('ServiceWorker')
			navigator.serviceWorker.register('/sw.js').catch((err) => {
				logger.warn('Service Worker registration failed', err)
			})
		}
	})
