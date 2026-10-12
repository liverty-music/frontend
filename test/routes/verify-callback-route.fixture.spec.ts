import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { createFixture } from '@aurelia/testing'
import { Registration } from 'aurelia'
import { describe, expect, it } from 'vitest'
import ja from '../../src/locales/ja/translation.json'
import { VerifyCallbackRoute } from '../../src/routes/verify-callback/verify-callback-route'
import { IIdentityVerificationService } from '../../src/services/identity-verification-service'

describe('VerifyCallbackRoute (fixture)', () => {
	it('@spec components/infrastructure/fan/web/global/ui-primitives "Identity verification in progress"', async () => {
		// The route's router hook is not run here, so the screen stays in its
		// initial waiting state: the Complete RPC has not answered yet.
		const fixture = await createFixture
			.html('<verify-callback-route></verify-callback-route>')
			.deps(
				I18nConfiguration.customize((options) => {
					options.initOptions = {
						lng: 'ja',
						resources: { ja: { translation: ja } },
						fallbackLng: 'ja',
					}
				}),
				Registration.instance(IIdentityVerificationService, {}),
				Registration.instance(IRouter, {}),
				VerifyCallbackRoute,
			)
			.build().started

		const waiting = fixture.appHost.querySelector('.verify-loading')
		expect(waiting).not.toBeNull()
		const indicator = waiting?.querySelector('circular-progress')
		expect(indicator).not.toBeNull()
		expect(
			indicator
				?.querySelector('[role="progressbar"]')
				?.getAttribute('aria-label'),
		).toBe(ja.common.loading)
		expect(waiting?.textContent).toContain(ja.verifyCallback.loading)
		expect(fixture.appHost.querySelector('loading-spinner')).toBeNull()

		await fixture.stop(true)
	})
})
