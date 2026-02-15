import { ILogger, resolve } from 'aurelia'
import { IRouter } from '@aurelia/router'
import { IAuthService } from './services/auth-service'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import { createPromiseClient } from '@connectrpc/connect'
import { transport } from './services/grpc-transport'

const artistClient = createPromiseClient(ArtistService, transport)

export class LandingPage {
	private authService = resolve(IAuthService)
	private router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('LandingPage')

	async attached(): Promise<void> {
		// Redirect authenticated users away from landing page
		if (this.authService.isAuthenticated) {
			try {
				this.logger.info('User is authenticated, checking onboarding status')
				const response = await artistClient.listFollowed({})
				const followedCount = response.artists.length

				if (followedCount >= 1) {
					this.logger.info('Redirecting to dashboard', { followedCount })
					await this.router.load('dashboard')
				} else {
					this.logger.info('Redirecting to artist discovery')
					await this.router.load('onboarding/discover')
				}
			} catch (err) {
				this.logger.error('Failed to check onboarding status, redirecting to discovery', err)
				await this.router.load('onboarding/discover')
			}
		}
	}

	async handleSignUp(): Promise<void> {
		await this.authService.register()
	}

	async handleSignIn(): Promise<void> {
		await this.authService.signIn()
	}
}
