import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { IAppConfig } from '../../src/config/app-config'
import type { User } from '../../src/entities/user'
import { IConsentService } from '../../src/lib/consent/consent-service'
import ja from '../../src/locales/ja/translation.json'
import { SettingsRoute } from '../../src/routes/settings/settings-route'
import { IAudioEngine } from '../../src/services/audio-engine'
import { IAuthService } from '../../src/services/auth-service'
import { IFabMenuService } from '../../src/services/fab-menu-service'
import {
	IIdentityVerificationService,
	type VerificationFailure,
} from '../../src/services/identity-verification-service'
import { IPushService } from '../../src/services/push-service'
import { IUserStore } from '../../src/services/user-store'
import { SETTINGS_ROWS } from '../helpers/settings-rows'

/** Sheet and selector stand-ins: the form under test does not use them. */
const UserHomeSelectorStub = CustomElement.define(
	{
		name: 'user-home-selector',
		template: '',
		bindables: ['currentCode', 'onHomeSelected'],
	},
	class {
		public open(): void {}
	},
)
const BottomSheetStub = CustomElement.define(
	{ name: 'bottom-sheet', template: '', bindables: ['open', 'ariaLabel'] },
	class {},
)

/**
 * A stand-in for the UserStore holding one signed-in User. Its
 * `updatePersonalDetails` applies the change the way the real store does:
 * the User the server returns replaces `current`.
 */
function makeUserStore(user: User) {
	const store = {
		current: user,
		currentHome: null,
		currentLanguage: 'ja',
		updatePersonalDetails: vi.fn(
			async (details: { fullName?: string; phoneNumber?: string }) => {
				store.current = { ...store.current, ...details }
				return store.current
			},
		),
	}
	return store
}

/** A stand-in for the AuthService of a signed-in fan. */
function makeAuth(emailVerified = true) {
	return {
		isAuthenticated: true,
		user: {
			profile: { email: 'fan@example.com', email_verified: emailVerified },
		},
		emailVerified,
		refreshEmailVerified: vi.fn(async () => {}),
	}
}

/** A stand-in for the IdentityVerificationService: unverified, no result. */
function makeIdentityVerifications(failure: VerificationFailure | null = null) {
	return { current: undefined, failure, takeVerifiedNotice: () => false }
}

async function render(
	store: ReturnType<typeof makeUserStore>,
	auth: ReturnType<typeof makeAuth> = makeAuth(),
	identityVerifications = makeIdentityVerifications(),
) {
	const fixture = await createFixture
		.html('<settings-route></settings-route>')
		.deps(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng: 'ja',
					resources: { ja: { translation: ja } },
					fallbackLng: 'ja',
				}
			}),
			Registration.instance(IAuthService, auth),
			Registration.instance(IUserStore, store),
			Registration.instance(IPushService, {
				resolvePushState: vi.fn(async () => 'needs-permission'),
			}),
			Registration.instance(
				IIdentityVerificationService,
				identityVerifications,
			),
			Registration.instance(IRouter, { load: vi.fn() }),
			Registration.instance(IAudioEngine, { muted: false, volume: 0.5 }),
			Registration.instance(IAppConfig, { vapidPublicKey: '' }),
			Registration.instance(IConsentService, {
				analytics: true,
				sessionReplay: true,
			}),
			Registration.instance(IFabMenuService, { isLeftHanded: false }),
			UserHomeSelectorStub,
			BottomSheetStub,
			...SETTINGS_ROWS,
			SettingsRoute,
		)
		.build().started

	const host = fixture.appHost
	const name = host.querySelector<HTMLInputElement>(
		'[data-testid="settings-full-name"]',
	)
	const phone = host.querySelector<HTMLInputElement>(
		'[data-testid="settings-phone-number"]',
	)
	const save = host.querySelector<HTMLButtonElement>(
		'[data-testid="settings-personal-details-save"]',
	)
	const form = host.querySelector<HTMLFormElement>(
		'[data-testid="settings-personal-details"]',
	)
	if (!name || !phone || !save || !form) {
		throw new Error('the name and phone form is not rendered')
	}
	return { fixture, host, name, phone, save, form }
}

/** Type into an input the way a fan does, so `value.bind` picks it up. */
function type(input: HTMLInputElement, value: string): void {
	input.value = value
	input.dispatchEvent(new Event('input'))
}

/** Submit the form and let the async save and the re-render settle. */
async function submit(form: HTMLFormElement): Promise<void> {
	form.dispatchEvent(new Event('submit', { cancelable: true }))
	await new Promise((r) => setTimeout(r, 0))
	await tasksSettled()
}

describe('SettingsRoute name and phone number (fixture)', () => {
	it('@spec components/infrastructure/fan/web/route/settings "Fan changes their phone number"', async () => {
		const store = makeUserStore({
			id: 'user-1',
			fullName: '山田 花子',
			phoneNumber: '+819012345678',
		})
		const { fixture, host, name, phone, save, form } = await render(store)

		// The saved values are shown, the phone in the domestic form, with the
		// note that they appear on the tickets.
		expect(name.value).toBe('山田 花子')
		expect(phone.value).toBe('090-1234-5678')
		expect(host.textContent).toContain(ja.settings.personalDetails.note)
		expect(save.disabled).toBe(true)

		type(phone, '090-9876-5432')
		await tasksSettled()
		expect(save.disabled).toBe(false)

		await submit(form)

		// Only the changed field is sent, in E.164 form.
		expect(store.updatePersonalDetails).toHaveBeenCalledWith({
			phoneNumber: '+819098765432',
		})
		expect(phone.value).toBe('090-9876-5432')
		expect(save.disabled).toBe(true)

		await fixture.stop(true)
	})

	it('@spec components/infrastructure/fan/web/route/settings "No details saved yet"', async () => {
		const store = makeUserStore({ id: 'user-1' })
		const { fixture, name, phone, form } = await render(store)

		expect(name.value).toBe('')
		expect(phone.value).toBe('')
		expect(name.disabled || name.readOnly).toBe(false)
		expect(phone.disabled || phone.readOnly).toBe(false)

		type(name, '鈴木 一郎')
		type(phone, '080-1111-2222')
		await submit(form)

		expect(store.updatePersonalDetails).toHaveBeenCalledWith({
			fullName: '鈴木 一郎',
			phoneNumber: '+818011112222',
		})
		expect(name.value).toBe('鈴木 一郎')
		expect(phone.value).toBe('080-1111-2222')

		await fixture.stop(true)
	})

	it('rejects a phone number in neither form without calling the server', async () => {
		const store = makeUserStore({ id: 'user-1' })
		const { fixture, host, phone, form } = await render(store)

		type(phone, '12345')
		await submit(form)

		expect(store.updatePersonalDetails).not.toHaveBeenCalled()
		expect(phone.getAttribute('aria-invalid')).toBe('true')
		expect(host.textContent).toContain(ja.settings.personalDetails.phoneInvalid)

		await fixture.stop(true)
	})
})

describe('SettingsRoute email verification badge (fixture)', () => {
	const badge = (host: HTMLElement) =>
		host.querySelector<HTMLOutputElement>('#email-verification-status')
	const resend = (host: HTMLElement) =>
		Array.from(host.querySelectorAll('button')).find((b) =>
			b.textContent?.includes(ja.settings.resendVerification),
		)

	it('@spec components/infrastructure/fan/web/route/settings "Verified on another device"', async () => {
		// Signed in on the laptop before verifying, so Settings opens unverified.
		const auth = makeAuth(false)
		const { fixture, host } = await render(
			makeUserStore({ id: 'user-1' }),
			auth,
		)
		expect(badge(host)?.textContent?.trim()).toBe('未確認')

		// The phone verifies; returning to the tab reads the current state.
		auth.refreshEmailVerified.mockImplementation(async () => {
			auth.emailVerified = true
		})
		document.dispatchEvent(new Event('visibilitychange'))
		await tasksSettled()

		expect(auth.refreshEmailVerified).toHaveBeenCalled()
		expect(badge(host)?.textContent?.trim()).toBe('確認済み')
		expect(resend(host)).toBeUndefined()

		await fixture.stop(true)
	})

	it('@spec components/infrastructure/fan/web/route/settings "Not yet verified"', async () => {
		const { fixture, host } = await render(
			makeUserStore({ id: 'user-1' }),
			makeAuth(false),
		)

		expect(badge(host)?.textContent?.trim()).toBe('未確認')
		const button = resend(host)
		expect(button?.textContent?.trim()).toBe('再送信')
		// The action sits beside the badge on the same status line.
		expect(button?.parentElement).toBe(badge(host)?.parentElement)

		await fixture.stop(true)
	})
})

describe('SettingsRoute Passkeys row (fixture)', () => {
	it('shows a Passkeys row in ACCOUNT that opens passkey management', async () => {
		const { fixture, host } = await render(
			makeUserStore({ id: 'user-1', fullName: '', phoneNumber: '' }),
		)
		const row = host.querySelector<HTMLButtonElement>(
			'[data-testid="settings-passkeys"]',
		)
		expect(row?.textContent).toContain(ja.settings.passkeys)
		row?.click()
		await tasksSettled()
		expect(fixture.container.get(IRouter).load).toHaveBeenCalledWith(
			'/settings/passkeys',
		)
	})
})

describe('SettingsRoute Sign Out group (fixture)', () => {
	it('puts Sign Out in its own group below ACCOUNT, at least 24px from the Passkeys row', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Sign out apart from account rows"
		const { host } = await render(
			makeUserStore({ id: 'user-1', fullName: '', phoneNumber: '' }),
		)
		const passkeys = host.querySelector('[data-testid="settings-passkeys"]')
		const signOut = host.querySelector('.settings-sign-out')
		const accountSection = passkeys?.closest('section')
		const signOutSection = signOut?.closest('section')

		// Passkeys is the last row of ACCOUNT; Sign Out is not in that card.
		expect(passkeys?.closest('li')?.nextElementSibling).toBeNull()
		expect(signOutSection).not.toBe(accountSection)
		expect(accountSection?.contains(signOut ?? null)).toBe(false)
		// The Sign Out group follows ACCOUNT directly in the scroll stack.
		expect(accountSection?.nextElementSibling).toBe(signOutSection)
		expect(signOutSection?.parentElement?.classList.contains('stack')).toBe(
			true,
		)

		// The stack's gap is --space-m, whose smallest value is 1.5rem (24px),
		// and Settings does not narrow it.
		const { default: compositions } = await import(
			'../../src/styles/compositions.css?raw'
		)
		const { default: tokens } = await import('../../src/styles/tokens.css?raw')
		const { default: settingsCss } = await import(
			'../../src/routes/settings/settings-route.css?raw'
		)
		expect(compositions).toContain('gap: var(--stack-gap, var(--space-m))')
		expect(tokens).toMatch(/--space-m:\s*clamp\(1\.5rem,/)
		const scrollRule = settingsCss.slice(
			settingsCss.indexOf('.settings-scroll {'),
		)
		expect(scrollRule.slice(0, scrollRule.indexOf('}'))).not.toContain(
			'--stack-gap',
		)
	})
})

describe('SettingsRoute identity verification result (fixture)', () => {
	const row = (host: HTMLElement) =>
		host.querySelector('[data-testid="identity-verification-failure"]')
	const verifyButton = (host: HTMLElement) =>
		[...host.querySelectorAll('button')].find(
			(b) =>
				b.textContent?.trim() === ja.settings.identityVerification.verifyCta,
		)

	it('shows the reason next to 本人確認する, which it describes', async () => {
		const { fixture, host } = await render(
			makeUserStore({ id: 'user-1' }),
			makeAuth(),
			makeIdentityVerifications('notCompleted'),
		)

		expect(row(host)?.textContent).toContain(
			ja.verifyCallback.error.notCompleted,
		)
		expect(row(host)?.querySelector('a')).toBeNull()
		expect(verifyButton(host)?.getAttribute('aria-describedby')).toBe(
			'identity-verification-failure',
		)

		await fixture.stop(true)
	})

	it('shows the support contact instead of 本人確認する for a card used by another account', async () => {
		const { fixture, host } = await render(
			makeUserStore({ id: 'user-1' }),
			makeAuth(),
			makeIdentityVerifications('alreadyVerified'),
		)

		expect(row(host)?.textContent).toContain(
			ja.verifyCallback.error.alreadyVerified,
		)
		expect(row(host)?.querySelector('a')?.getAttribute('href')).toBe(
			'mailto:pannpers@pannpers.dev',
		)
		expect(verifyButton(host)).toBeUndefined()

		await fixture.stop(true)
	})

	it('shows no reason when there is none', async () => {
		const { fixture, host } = await render(makeUserStore({ id: 'user-1' }))

		expect(row(host)).toBeNull()
		expect(verifyButton(host)?.hasAttribute('aria-describedby')).toBe(false)

		await fixture.stop(true)
	})
})
