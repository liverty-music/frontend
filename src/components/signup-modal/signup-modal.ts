import { bindable, customElement, ILogger, resolve } from 'aurelia'
import { IAuthService } from '../../services/auth-service'

@customElement({
	name: 'signup-modal',
	template: `
		<div if.bind="active" class="fixed inset-0 z-[70] flex items-center justify-center bg-black/85">
			<div class="mx-6 px-6 py-8 max-w-96 w-full bg-surface-raised border border-white/10 rounded-3xl text-center">
				<div class="text-5xl mb-4">🎵</div>
				<h2 class="font-display text-xl font-bold text-text-primary mb-3">アカウントを作成しよう</h2>
				<p class="text-sm text-text-muted leading-relaxed mb-6">
					チュートリアルお疲れさまでした！<br>
					Passkeyで安全にアカウントを作成して、<br>
					フォローしたアーティストの情報を保存しましょう。
				</p>
				<button
					click.trigger="handleSignUp()"
					disabled.bind="isSigningUp"
					class="w-full py-3.5 px-6 bg-brand-primary text-white font-display font-semibold text-[0.9375rem] border-none rounded-[var(--radius-button)] cursor-pointer transition-opacity min-h-12 flex items-center justify-center hover:opacity-85 disabled:opacity-60 disabled:cursor-not-allowed"
				>
					<span if.bind="!isSigningUp">Passkeyでアカウント作成</span>
					<span if.bind="isSigningUp" class="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
				</button>
				<p if.bind="signUpError" class="mt-3 text-[0.8125rem] text-red-400">\${signUpError}</p>
			</div>
		</div>
	`,
})
export class SignupModal {
	@bindable public active = false

	public isSigningUp = false
	public signUpError = ''

	private readonly authService = resolve(IAuthService)
	private readonly logger = resolve(ILogger).scopeTo('SignupModal')

	public async handleSignUp(): Promise<void> {
		if (this.isSigningUp) return

		this.isSigningUp = true
		this.signUpError = ''

		try {
			this.logger.info('Tutorial signup: initiating Passkey registration')
			await this.authService.signUp()
			// signUp redirects to Zitadel, so we won't reach here normally
		} catch (err) {
			this.logger.error('Signup failed', { error: err })
			this.signUpError =
				'アカウント作成に失敗しました。もう一度お試しください。'
			this.isSigningUp = false
		}
	}
}
