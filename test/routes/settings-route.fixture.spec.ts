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
import { IIdentityVerificationService } from '../../src/services/identity-verification-service'
import { IPushService } from '../../src/services/push-service'
import { IUserStore } from '../../src/services/user-store'

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

async function render(store: ReturnType<typeof makeUserStore>) {
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
			Registration.instance(IAuthService, {
				isAuthenticated: true,
				user: { profile: { email: 'fan@example.com', email_verified: true } },
			}),
			Registration.instance(IUserStore, store),
			Registration.instance(IPushService, {
				resolvePushState: vi.fn(async () => 'needs-permission'),
			}),
			Registration.instance(IIdentityVerificationService, {
				status: undefined,
			}),
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
