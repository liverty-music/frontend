import { RouterConfiguration } from '@aurelia/router'
import Aurelia, { ConsoleSink, LoggerConfiguration, LogLevel } from 'aurelia'
import { AuthStatus } from './components/auth-status'
import { IToastService } from './components/toast-notification/toast-notification'
import { MyApp } from './my-app'
import { IArtistDiscoveryService } from './services/artist-discovery-service'
import { IAuthService } from './services/auth-service'

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
	.register(RouterConfiguration)
	.register(
		LoggerConfiguration.create({
			level: LogLevel.debug,
			sinks: [ConsoleSink],
		}),
	)
	.register(IAuthService)
	.register(IArtistDiscoveryService)
	.register(IToastService)
	// Register components globally or locally. Global is easier for AuthStatus used in shell.
	.register(AuthStatus)
	// To use HTML5 pushState routes, replace previous line with the following
	// customized router config.
	// .register(RouterConfiguration.customize({ useUrlFragmentHash: false }))
	.app(MyApp)
	.start()
