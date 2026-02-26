import { RouterConfiguration } from '@aurelia/router'
import Aurelia, { ConsoleSink, LoggerConfiguration, LogLevel } from 'aurelia'
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
import { IGuestDataMergeService } from './services/guest-data-merge-service'
import { ILocalArtistClient } from './services/local-artist-client'
import { INotificationManager } from './services/notification-manager'
import { IOnboardingService } from './services/onboarding-service'
import { initOtel } from './services/otel-init'
import { OtelLogSink } from './services/otel-log-sink'
import { IProofService } from './services/proof-service'
import { IPushService } from './services/push-service'
import { IPwaInstallService } from './services/pwa-install-service'
import { ITicketService } from './services/ticket-service'
import { IUserService } from './services/user-service'
import { DateValueConverter } from './value-converters/date'

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
	.register(IOnboardingService)
	.register(ILocalArtistClient)
	.register(IGuestDataMergeService)
	.register(INotificationManager)
	.register(IPushService)
	.register(IPwaInstallService)
	.register(ITicketService)
	.register(IEntryService)
	.register(IProofService)
	.register(IToastService)
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
	navigator.serviceWorker
		.register('/sw.js')
		.then(async (registration) => {
			// Register Periodic Background Sync for concert data refresh (Chromium only).
			if ('periodicSync' in registration) {
				try {
					await (
						registration as ServiceWorkerRegistration & {
							periodicSync: {
								register(
									tag: string,
									options: { minInterval: number },
								): Promise<void>
							}
						}
					).periodicSync.register('concert-refresh', {
						minInterval: 12 * 60 * 60 * 1000, // 12 hours
					})
				} catch {
					// Periodic sync not granted or not supported — silent fallback.
				}
			}
		})
		.catch((err) => {
			console.warn('Service Worker registration failed:', err)
		})

	// Handle REFRESH_CONCERT_CACHE messages from the SW's periodicsync handler.
	// The SW cannot obtain fresh OIDC tokens, so the main thread performs the
	// re-fetch with live credentials and updates the cache.
	navigator.serviceWorker.addEventListener('message', async (event) => {
		if (event.data?.type !== 'REFRESH_CONCERT_CACHE') return

		const { UserManager, WebStorageStateStore } = await import('oidc-client-ts')
		const userManager = new UserManager({
			authority: import.meta.env.VITE_ZITADEL_ISSUER,
			client_id: import.meta.env.VITE_ZITADEL_CLIENT_ID,
			redirect_uri: `${window.location.origin}/auth/callback`,
			response_type: 'code',
			scope: 'openid',
			userStore: new WebStorageStateStore({ store: window.localStorage }),
		})

		const user = await userManager.getUser()
		if (!user?.access_token) return

		const cache = await caches.open('concert-api-v1')
		const keys = await cache.keys()

		for (const request of keys) {
			try {
				const freshRequest = new Request(request.url, {
					method: request.method,
					headers: { Authorization: `Bearer ${user.access_token}` },
				})
				const response = await fetch(freshRequest)
				if (response.ok) {
					await cache.put(request, response)
				}
			} catch {
				// Silent failure — will retry at next periodic sync interval.
			}
		}
	})
}
