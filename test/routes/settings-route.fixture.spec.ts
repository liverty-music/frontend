import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { IAppConfig } from '../../src/config/app-config'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import type { IdentityVerification } from '../../src/entities/identity-verification'
import type { User } from '../../src/entities/user'
import { IConsentService } from '../../src/lib/consent/consent-service'
import en from '../../src/locales/en/translation.json'
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

/**
 * Sheet and selector stand-ins. The sheet projects its content, so the name
 * and phone form in it renders; whether it is open is `vm.personalDetailsOpen`.
 */
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
	{
		name: 'bottom-sheet',
		template: '<au-slot></au-slot>',
		bindables: ['open', 'ariaLabel'],
	},
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

/** A stand-in for the AuthService of a signed-in fan (or of a guest). */
function makeAuth(emailVerified = true, isAuthenticated = true) {
	return {
		isAuthenticated,
		user: isAuthenticated
			? {
					profile: { email: 'fan@example.com', email_verified: emailVerified },
				}
			: null,
		emailVerified,
		refreshEmailVerified: vi.fn(async () => {}),
		signOut: vi.fn(async () => {}),
	}
}

/** A stand-in for the IdentityVerificationService: unverified, no result. */
function makeIdentityVerifications(
	failure: VerificationFailure | null = null,
	current: IdentityVerification | undefined = undefined,
) {
	return {
		current,
		failure,
		takeVerifiedNotice: () => false,
		get: vi.fn(async () => current),
	}
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
			BusyOnClickCustomAttribute,
			...SETTINGS_ROWS,
			SettingsRoute,
		)
		.build().started

	const host = fixture.appHost
	const vm = CustomElement.for<SettingsRoute>(
		host.querySelector('settings-route') as HTMLElement,
	).viewModel
	const q = <T extends Element>(testId: string) =>
		host.querySelector<T>(`[data-testid="${testId}"]`) as T
	return {
		fixture,
		host,
		vm,
		q,
		row: () => q<HTMLButtonElement>('settings-personal-details-row'),
		name: q<HTMLInputElement>('settings-full-name'),
		phone: q<HTMLInputElement>('settings-phone-number'),
		save: q<HTMLButtonElement>('settings-personal-details-save'),
		form: q<HTMLFormElement>('settings-personal-details'),
		confirm: q<HTMLDialogElement>('settings-personal-details-confirm'),
		confirmYes: q<HTMLButtonElement>(
			'settings-personal-details-confirm-confirm',
		),
		confirmNo: q<HTMLButtonElement>('settings-personal-details-confirm-cancel'),
	}
}

/** The section titles from top to bottom. */
function sectionTitles(host: HTMLElement): string[] {
	return [...host.querySelectorAll('.settings-section-title')].map(
		(h) => h.textContent?.trim() ?? '',
	)
}

/** Let clicks, async handlers and the re-render settle. */
async function settle(): Promise<void> {
	await new Promise((r) => setTimeout(r, 0))
	await tasksSettled()
}

/** Type into an input the way a fan does, so `value.bind` picks it up. */
function type(input: HTMLInputElement, value: string): void {
	input.value = value
	input.dispatchEvent(new Event('input'))
}

/** Submit the form and let the async save and the re-render settle. */
async function submit(form: HTMLFormElement): Promise<void> {
	form.dispatchEvent(new Event('submit', { cancelable: true }))
	await settle()
}

describe('SettingsRoute name and phone number (fixture)', () => {
	it('@spec components/infrastructure/fan/web/route/settings "Fan changes their phone number"', async () => {
		const store = makeUserStore({
			id: 'user-1',
			fullName: '山田 花子',
			phoneNumber: '+819012345678',
		})
		const r = await render(store)

		// One row shows the saved values, the phone in the domestic form, with
		// the note that they appear on the tickets.
		expect(r.row().textContent).toContain('山田 花子')
		expect(r.row().textContent).toContain('090-1234-5678')
		expect(r.host.textContent).toContain(ja.settings.personalDetails.note)

		r.row().click()
		await settle()
		expect(r.vm.personalDetailsOpen).toBe(true)
		expect(r.name.value).toBe('山田 花子')
		expect(r.phone.value).toBe('090-1234-5678')
		expect(r.save.disabled).toBe(true)

		type(r.phone, '090-9876-5432')
		await tasksSettled()
		expect(r.save.disabled).toBe(false)
		await submit(r.form)
		r.confirmYes.click()
		await settle()

		// Only the changed field is sent, in E.164 form.
		expect(store.updatePersonalDetails).toHaveBeenCalledWith({
			phoneNumber: '+819098765432',
		})
		expect(r.vm.personalDetailsOpen).toBe(false)
		expect(r.row().textContent).toContain('090-9876-5432')

		await r.fixture.stop(true)
	})

	it('@spec components/infrastructure/fan/web/route/settings "Saving asks first"', async () => {
		const store = makeUserStore({
			id: 'user-1',
			fullName: '山田 花子',
			phoneNumber: '+819012345678',
		})
		const r = await render(store)
		r.row().click()
		await settle()

		type(r.name, '山田 花')
		await submit(r.form)

		// A modal dialog with the new name and phone number, on one line, and
		// what the change does; Cancel has focus; nothing is saved yet.
		expect(r.confirm.hasAttribute('open')).toBe(true)
		expect(r.confirm.textContent).toContain(
			ja.settings.personalDetails.confirm.title,
		)
		expect(r.confirm.textContent).toContain('山田 花 / 090-1234-5678')
		expect(r.confirm.textContent).toContain(
			'保有中のチケットの券面もこの名義に変わります',
		)
		expect(document.activeElement).toBe(r.confirmNo)
		expect(store.updatePersonalDetails).not.toHaveBeenCalled()

		await r.fixture.stop(true)
	})

	it.each([
		['Cancel', (r: Awaited<ReturnType<typeof render>>) => r.confirmNo.click()],
		[
			'Escape',
			(r: Awaited<ReturnType<typeof render>>) => {
				// A browser turns Escape into a `close` of the modal dialog.
				r.confirm.removeAttribute('open')
				r.confirm.dispatchEvent(new Event('close'))
			},
		],
	])(
		'@spec components/infrastructure/fan/web/route/settings "Fan cancels the confirmation" (%s)',
		async (_, dismiss) => {
			const store = makeUserStore({ id: 'user-1', fullName: '山田 花子' })
			const r = await render(store)
			r.row().click()
			await settle()

			type(r.name, '鈴木 一郎')
			await submit(r.form)
			dismiss(r)
			await settle()

			expect(store.updatePersonalDetails).not.toHaveBeenCalled()
			expect(r.confirm.hasAttribute('open')).toBe(false)
			// The sheet stays open with what the fan typed.
			expect(r.vm.personalDetailsOpen).toBe(true)
			expect(r.name.value).toBe('鈴木 一郎')

			await r.fixture.stop(true)
		},
	)

	it('opens no confirmation for an unchanged form', async () => {
		const store = makeUserStore({ id: 'user-1', fullName: '山田 花子' })
		const r = await render(store)
		r.row().click()
		await settle()
		await submit(r.form)

		expect(r.confirm.hasAttribute('open')).toBe(false)
		expect(store.updatePersonalDetails).not.toHaveBeenCalled()
		await r.fixture.stop(true)
	})

	it('re-seeds the form each time the sheet opens, so a cancelled edit does not come back', async () => {
		const store = makeUserStore({ id: 'user-1', fullName: '山田 花子' })
		const r = await render(store)
		r.row().click()
		await settle()
		type(r.name, '鈴木 一郎')
		// The fan swipes the sheet away.
		r.vm.personalDetailsOpen = false

		r.row().click()
		await settle()
		expect(r.name.value).toBe('山田 花子')
		await r.fixture.stop(true)
	})

	it('@spec components/infrastructure/fan/web/route/settings "No details saved yet"', async () => {
		const store = makeUserStore({ id: 'user-1' })
		const r = await render(store)

		expect(r.row().textContent).toContain(ja.settings.notSet)
		r.row().click()
		await settle()

		expect(r.name.value).toBe('')
		expect(r.phone.value).toBe('')
		expect(r.name.disabled || r.name.readOnly).toBe(false)
		expect(r.phone.disabled || r.phone.readOnly).toBe(false)

		type(r.name, '鈴木 一郎')
		type(r.phone, '080-1111-2222')
		await submit(r.form)
		r.confirmYes.click()
		await settle()

		expect(store.updatePersonalDetails).toHaveBeenCalledWith({
			fullName: '鈴木 一郎',
			phoneNumber: '+818011112222',
		})
		expect(r.row().textContent).toContain('鈴木 一郎')
		expect(r.row().textContent).toContain('080-1111-2222')

		await r.fixture.stop(true)
	})

	it('rejects a phone number in neither form without asking or calling the server', async () => {
		const store = makeUserStore({ id: 'user-1' })
		const r = await render(store)
		r.row().click()
		await settle()

		type(r.phone, '12345')
		await submit(r.form)

		expect(r.confirm.hasAttribute('open')).toBe(false)
		expect(store.updatePersonalDetails).not.toHaveBeenCalled()
		expect(r.phone.getAttribute('aria-invalid')).toBe('true')
		expect(r.host.textContent).toContain(
			ja.settings.personalDetails.phoneInvalid,
		)

		await r.fixture.stop(true)
	})
})

describe('SettingsRoute section order (fixture)', () => {
	it('@spec components/infrastructure/fan/web/route/settings "Signed-in fan sees the account first"', async () => {
		const r = await render(makeUserStore({ id: 'user-1' }))
		expect(sectionTitles(r.host)).toEqual([
			'アカウント',
			'チケットの名義',
			'通知とサウンド',
			'表示と操作',
			'サービス改善の協力',
			'このアプリについて',
		])
		// About, then the Sign Out group, then the Delete account group.
		const scroll = r.q('settings-scroll')
		const groups = [...scroll.children].map(
			(c) =>
				c.getAttribute('data-testid') ?? c.querySelector('h2')?.textContent,
		)
		expect(groups.slice(-3)).toEqual([
			'このアプリについて',
			'settings-sign-out-group',
			'settings-delete-account-group',
		])
		await r.fixture.stop(true)
	})

	it('@spec components/infrastructure/fan/web/route/settings "Guest sees the hero, then the preferences"', async () => {
		const r = await render(
			makeUserStore({ id: 'user-1' }),
			makeAuth(true, false),
		)
		const scroll = r.q('settings-scroll')
		expect(
			scroll.firstElementChild?.classList.contains('settings-guest-hero'),
		).toBe(true)
		expect(sectionTitles(r.host)).toEqual([
			'通知とサウンド',
			'表示と操作',
			'サービス改善の協力',
			'このアプリについて',
		])
		// 通知とサウンド holds Sound Effects (and its volume) only.
		const notifications = [...scroll.querySelectorAll('section')].find(
			(sec) => sec.querySelector('h2')?.textContent === '通知とサウンド',
		)
		expect(notifications?.textContent).toContain(ja.settings.soundEffects)
		expect(notifications?.textContent).not.toContain(
			ja.settings.pushNotifications,
		)
		expect(r.q('settings-personal-details-row')).toBeNull()
		expect(r.q('settings-sign-out-group')).toBeNull()
		expect(r.q('settings-delete-account-group')).toBeNull()
		await r.fixture.stop(true)
	})
})

describe('SettingsRoute rows (fixture)', () => {
	it('@spec components/infrastructure/fan/web/route/settings "Consent rows and Passkeys"', async () => {
		const r = await render(makeUserStore({ id: 'user-1' }))
		const icons = [...r.host.querySelectorAll('svg-icon.settings-icon')].map(
			(i) => (i as HTMLElement & { name?: string }).name,
		)
		expect(icons).toContain('chart')
		expect(icons).toContain('pointer')
		expect(icons).toContain('lock')
		// No two rows share an icon.
		expect(new Set(icons).size).toBe(icons.length)
		await r.fixture.stop(true)
	})

	it('@spec components/infrastructure/fan/web/route/settings "One Privacy Policy link next to the toggles"', async () => {
		const r = await render(makeUserStore({ id: 'user-1' }))
		const rows = [...r.host.querySelectorAll('.settings-row')].filter((row) =>
			row.textContent?.includes(ja.settings.privacyPolicy),
		)
		// The About row is the only Privacy Policy row.
		expect(rows).toEqual([r.q('settings-privacy-policy')])
		const note = r.q('settings-analytics-policy-note')
		expect(note.textContent?.replace(/\s+/g, '')).toBe(
			'データの扱いはプライバシーポリシーで詳しく説明しています。',
		)
		expect(
			r
				.q<HTMLAnchorElement>('settings-analytics-policy-link')
				.getAttribute('href'),
		).toBe('/legal/privacy')
		await r.fixture.stop(true)
	})

	it('@spec components/infrastructure/fan/web/route/settings "Contact support"', async () => {
		const r = await render(makeUserStore({ id: 'user-1' }))
		const contact = r.q<HTMLAnchorElement>('settings-contact')
		expect(contact.textContent).toContain('お問い合わせ')
		expect(contact.getAttribute('href')).toBe('mailto:pannpers@pannpers.dev')
		await r.fixture.stop(true)
	})

	it('@spec components/infrastructure/fan/web/route/settings "Fan verified with My Number Card"', async () => {
		const r = await render(
			makeUserStore({ id: 'user-1' }),
			makeAuth(),
			makeIdentityVerifications(null, {
				id: 'iv-1',
				userId: 'user-1',
				method: 'jpki',
				providerUserId: 'provider-1',
				dedupeStrength: 'strong',
				status: 'active',
			}),
		)
		expect(r.host.textContent).toContain('1人1アカウントを確実に確認済み')
		expect(r.host.textContent).not.toContain('重複排除')
		await r.fixture.stop(true)
	})
})

describe('Consent wording', () => {
	const descriptions = (locale: typeof ja) => [
		locale.settings.analytics.toggleDescription,
		locale.settings.analytics.sessionReplayDescription,
	]

	it('@spec components/infrastructure/fan/web/route/settings "No anonymity claim"', () => {
		for (const text of descriptions(ja)) expect(text).not.toContain('匿名')
		for (const text of descriptions(en)) expect(text).not.toMatch(/anonym/i)
	})

	it('@spec components/infrastructure/fan/web/route/settings "Analytics toggle is labeled by its purpose"', async () => {
		const r = await render(makeUserStore({ id: 'user-1' }))
		const section = r.host.querySelector(
			'section[aria-labelledby="analytics-title"]',
		)
		expect(section?.textContent).toContain(ja.settings.analytics.intro)
		expect(section?.textContent).toContain('利用状況を共有する')
		expect(ja.settings.analytics.toggleDescription).toContain(
			'名前・メールアドレス・電話番号などは送りません',
		)
		await r.fixture.stop(true)
	})

	it('@spec components/infrastructure/fan/web/route/settings "Session-replay toggle is labeled by its purpose"', async () => {
		const r = await render(makeUserStore({ id: 'user-1' }))
		const section = r.host.querySelector(
			'section[aria-labelledby="analytics-title"]',
		)
		expect(section?.textContent).toContain('画面操作ログを共有する')
		expect(ja.settings.analytics.sessionReplayDescription).toContain(
			'入力内容や画面の文字を伏せて',
		)
		expect(ja.settings.analytics.sessionReplayDescription).toContain(
			'他の設定には影響しません',
		)
		await r.fixture.stop(true)
	})
})

describe('SettingsRoute sign-out confirmation (fixture)', () => {
	const open = async () => {
		const auth = makeAuth()
		const r = await render(makeUserStore({ id: 'user-1' }), auth)
		r.host.querySelector<HTMLButtonElement>('.settings-sign-out')?.click()
		await settle()
		const dialog = r.q<HTMLDialogElement>('settings-sign-out-confirm')
		return { ...r, auth, dialog }
	}

	it('@spec components/infrastructure/fan/web/route/settings "Sign out asks first"', async () => {
		const r = await open()
		expect(r.dialog.hasAttribute('open')).toBe(true)
		expect(r.dialog.textContent).toContain('サインアウトしますか？')
		expect(r.dialog.textContent).toContain(ja.settings.signOutConfirm.body)
		expect(document.activeElement).toBe(r.q('settings-sign-out-confirm-cancel'))
		expect(r.auth.signOut).not.toHaveBeenCalled()
		// Nothing is in progress while the fan decides.
		const button = r.host.querySelector('.settings-sign-out')
		expect(button?.hasAttribute('data-busy')).toBe(false)

		let finish: () => void = () => {}
		r.auth.signOut.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve
				}),
		)
		r.q<HTMLButtonElement>('settings-sign-out-confirm-confirm').click()
		await settle()
		// Busy from the confirmation until the sign-out returns.
		expect(button?.hasAttribute('data-busy')).toBe(true)
		finish()
		await settle()
		expect(r.auth.signOut).toHaveBeenCalledTimes(1)
		await r.fixture.stop(true)
	})

	it.each([
		[
			'Cancel',
			(r: Awaited<ReturnType<typeof open>>) =>
				r.q<HTMLButtonElement>('settings-sign-out-confirm-cancel').click(),
		],
		[
			'Escape',
			(r: Awaited<ReturnType<typeof open>>) => {
				r.dialog.removeAttribute('open')
				r.dialog.dispatchEvent(new Event('close'))
			},
		],
	])(
		'@spec components/infrastructure/fan/web/route/settings "Sign out cancelled" (%s)',
		async (_, dismiss) => {
			const r = await open()
			dismiss(r)
			await settle()
			expect(r.dialog.hasAttribute('open')).toBe(false)
			expect(r.auth.signOut).not.toHaveBeenCalled()
			await r.fixture.stop(true)
		},
	)
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
	it('puts Sign Out in its own group below About, at least 24px from its last row', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Sign out apart from account rows"
		const { host } = await render(
			makeUserStore({ id: 'user-1', fullName: '', phoneNumber: '' }),
		)
		const signOut = host.querySelector('.settings-sign-out')
		const aboutSection = [...host.querySelectorAll('section')].find(
			(sec) => sec.querySelector('h2')?.textContent === ja.settings.about,
		)
		const signOutSection = signOut?.closest('section')

		// Sign Out is not in About's card.
		expect(signOutSection).not.toBe(aboutSection)
		expect(aboutSection?.contains(signOut ?? null)).toBe(false)
		// The Sign Out group follows About directly in the scroll stack.
		expect(aboutSection?.nextElementSibling).toBe(signOutSection)
		expect(signOutSection?.parentElement?.classList.contains('stack')).toBe(
			true,
		)

		// The stack's gap is --space-m, 24px, and Settings does not narrow it.
		const { default: compositions } = await import(
			'../../src/styles/compositions.css?raw'
		)
		const { default: tokens } = await import('../../src/styles/tokens.css?raw')
		const { default: settingsCss } = await import(
			'../../src/routes/settings/settings-route.css?raw'
		)
		expect(compositions).toContain('gap: var(--stack-gap, var(--space-m))')
		expect(tokens).toMatch(/--space-m:\s*24px;/)
		const scrollRule = settingsCss.slice(
			settingsCss.indexOf('.settings-scroll {'),
		)
		expect(scrollRule.slice(0, scrollRule.indexOf('}'))).not.toContain(
			'--stack-gap',
		)
	})
})

describe('SettingsRoute Delete account group (fixture)', () => {
	it('shows Delete account in its own group below Sign Out, at least 24px apart, opening the withdrawal screen', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Signed-in fan"
		const { fixture, host } = await render(
			makeUserStore({ id: 'user-1', fullName: '', phoneNumber: '' }),
		)
		const row = host.querySelector<HTMLButtonElement>(
			'[data-testid="settings-delete-account"]',
		)
		expect(row?.textContent).toContain(ja.settings.deleteAccount)

		const signOutSection = host
			.querySelector('.settings-sign-out')
			?.closest('section')
		const deleteSection = row?.closest('section')
		// A group of its own, directly below Sign Out in the scroll stack,
		// whose gap is at least 24px (asserted for Sign Out above).
		expect(deleteSection).not.toBe(signOutSection)
		expect(signOutSection?.contains(row ?? null)).toBe(false)
		expect(signOutSection?.nextElementSibling).toBe(deleteSection)
		expect(deleteSection?.parentElement?.classList.contains('stack')).toBe(true)

		row?.click()
		await tasksSettled()
		expect(fixture.container.get(IRouter).load).toHaveBeenCalledWith(
			'/settings/delete-account',
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
