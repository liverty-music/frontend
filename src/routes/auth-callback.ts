import { IRouter } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../services/auth-service'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import { createPromiseClient } from '@connectrpc/connect'
import { transport } from '../services/grpc-transport'

const artistClient = createPromiseClient(ArtistService, transport)

export class AuthCallback {
	public message = 'Verifying authentication...'
	public error = ''

	private authService = resolve(IAuthService)
	private router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('AuthCallback')

	constructor() {
		this.logger.info('Constructor called')
	}

	// biome-ignore lint/suspicious/noExplicitAny: Params are dynamic
	public async loading(params: any): Promise<void> {
		this.logger.info('Starting loading hook...', params)
		try {
			this.logger.info('Calling handleCallback...')
			await this.authService.handleCallback()
			this.logger.info('handleCallback success!')
			await this.redirectAfterAuth()
		} catch (err) {
			this.logger.error('Auth callback error:', err)

			// If we are already authenticated (e.g. valid session exists), ignore the error and redirect
			if (this.authService.isAuthenticated) {
				this.logger.warn(
					'User is already authenticated. Redirecting despite callback error...',
				)
				await this.redirectAfterAuth()
				return
			}

			this.error = `Login failed: ${err instanceof Error ? err.message : String(err)}`
			this.message = ''
		}
	}

	private async redirectAfterAuth(): Promise<void> {
		try {
			// Check onboarding status via ListFollowed RPC
			this.logger.info('Checking onboarding status via ListFollowed RPC')
			const response = await artistClient.listFollowed({})
			const followedCount = response.artists.length

			if (followedCount >= 1) {
				this.logger.info('User has followed artists, redirecting to dashboard', {
					followedCount,
				})
				await this.router.load('dashboard')
			} else {
				this.logger.info('New user with no followed artists, redirecting to discovery')
				await this.router.load('onboarding/discover')
			}
		} catch (err) {
			this.logger.error('Failed to check onboarding status, defaulting to discovery', err)
			// On error, redirect to discovery (safer default for new users)
			await this.router.load('onboarding/discover')
		}
	}
}
