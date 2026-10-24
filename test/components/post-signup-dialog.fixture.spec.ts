import { I18N, I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { PostSignupDialog } from '../../src/components/post-signup-dialog/post-signup-dialog'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { IFollowStore } from '../../src/services/follow-store'
import { INotificationManager } from '../../src/services/notification-manager'
import { IPromptCoordinator } from '../../src/services/prompt-coordinator'
import {
	IPushOfferService,
	type PushOfferOutcome,
} from '../../src/services/push-offer-service'
import { IPwaInstallService } from '../../src/services/pwa-install-service'

/**
 * Renders the real post-signup dialog template. The bottom sheet is a
 * pass-through stub (jsdom has no Popover API); its own open/dismiss behaviour
 * is covered by the bottom-sheet specs.
 */
const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<au-slot if.bind="open"></au-slot>',
		bindables: ['open', 'ariaLabel'],
	},
	class {},
)

interface RenderOptions {
	permission?: NotificationPermission
	canReceivePush?: boolean
	/** The browser can install the app (Chromium). */
	installable?: boolean
	/** The browser already captured its own install prompt. */
	nativePrompt?: boolean
	installed?: boolean
	ios?: boolean
	followed?: number
	outcome?: PushOfferOutcome
	lng?: 'ja' | 'en'
}

async function render(opts: RenderOptions = {}) {
	const notifications = { permission: opts.permission ?? 'default' }
	const pushOffer = {
		canReceivePush: opts.canReceivePush ?? true,
		accept: vi.fn(async () => {
			const outcome = opts.outcome ?? 'granted'
			if (outcome !== 'failed') notifications.permission = outcome
			return outcome
		}),
	}
	const pwaInstall = {
		canShowInstallOption:
			(opts.installable ?? true) && !opts.installed && !opts.ios,
		canShowFab: (opts.nativePrompt ?? false) && !opts.installed,
		isIos: opts.ios ?? false,
		isInstalled: opts.installed ?? false,
		install: vi.fn(async () => {}),
	}
	const coordinator = { isPostSignupSurfaceOpen: false }
	const fixture = await createFixture(
		'<post-signup-dialog active.bind="active"></post-signup-dialog>',
		class Host {
			public active = true
		},
		[
			I18nConfiguration.customize((o) => {
				o.initOptions = {
					lng: opts.lng ?? 'ja',
					resources: { ja: { translation: ja }, en: { translation: en } },
				}
			}),
			PostSignupDialog,
			BottomSheetStub,
			BusyOnClickCustomAttribute,
			Registration.instance(INotificationManager, notifications),
			Registration.instance(IPushOfferService, pushOffer),
			Registration.instance(IPwaInstallService, pwaInstall),
			Registration.instance(IPromptCoordinator, coordinator),
			Registration.instance(IFollowStore, {
				followedCount: opts.followed ?? 5,
			}),
		],
	).started
	await tasksSettled()

	const host = fixture.appHost
	const text = (selector: string) =>
		host.querySelector(selector)?.textContent?.trim() ?? null
	const buttons = () =>
		[
			...host.querySelectorAll<HTMLButtonElement>(
				'.post-signup-actions button',
			),
		].map((b) => b.textContent?.trim())
	const press = async (label: string) => {
		const button = [
			...host.querySelectorAll<HTMLButtonElement>(
				'.post-signup-actions button',
			),
		].find((b) => b.textContent?.trim() === label)
		if (!button) throw new Error(`no button ${label}`)
		button.click()
		await vi.waitFor(async () => {
			await tasksSettled()
		})
		await tasksSettled()
	}
	const step = () =>
		host.querySelector<HTMLElement>('.post-signup-step')?.dataset.step ?? null
	return {
		fixture,
		host,
		text,
		buttons,
		press,
		step,
		pushOffer,
		pwaInstall,
		coordinator,
	}
}

const t = ja.postSignup

describe('PostSignupDialog', () => {
	describe('steps', () => {
		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Both steps in order"
		it('asks for notifications, then for the home screen, then closes', async () => {
			const d = await render()

			expect(d.step()).toBe('notify')
			expect(d.buttons()).toEqual([t.notify.enable, t.defer])

			await d.press(t.defer)
			expect(d.step()).toBe('install')
			expect(d.buttons()).toEqual([t.install.add, t.defer])

			await d.press(t.defer)
			expect(d.step()).toBeNull()
			expect(d.coordinator.isPostSignupSurfaceOpen).toBe(false)
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Notification already decided"
		it('skips the notification step once the permission is decided', async () => {
			for (const permission of ['granted', 'denied'] as const) {
				const d = await render({ permission })
				expect(d.step()).toBe('install')
			}
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Nothing left to ask"
		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Celebration Precedes Post-Signup Dialog"
		it('does not open when nothing is left to ask', async () => {
			const installed = await render({ permission: 'granted', installed: true })
			expect(installed.step()).toBeNull()
			expect(installed.coordinator.isPostSignupSurfaceOpen).toBe(false)

			const cannot = await render({ permission: 'denied', installable: false })
			expect(cannot.step()).toBeNull()
		})
	})

	describe('notification step', () => {
		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Fan follows five artists"
		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Title renders in Japanese locale"
		it('says the search for the followed artists has started', async () => {
			const d = await render({ followed: 5 })

			expect(d.text('.post-signup-title')).toBe(
				'新着ライブを、いち早くお知らせ',
			)
			expect(d.text('.post-signup-body')).toBe(
				'フォロー中の5組のライブを探し始めました。見つかったら通知で届けます。',
			)
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Fan follows no artist"
		it('has a body without a count for a fan who follows no artist', async () => {
			const d = await render({ followed: 0 })

			expect(d.text('.post-signup-body')).toBe(
				'新しいライブが見つかったら、通知で届けます。',
			)
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Fan allows notifications"
		// @spec components/infrastructure/fan/web/global/notification-prompt "Offer after sign-up"
		it('asks the browser within the tap and moves on when the fan allows', async () => {
			const d = await render()

			await d.press(t.notify.enable)

			expect(d.pushOffer.accept).toHaveBeenCalledWith({
				source: 'post_signup_dialog',
				counted: false,
				inline: true,
			})
			expect(d.step()).toBe('install')
		})

		it('closes after the fan allows when no step remains', async () => {
			const d = await render({ installed: true })

			await d.press(t.notify.enable)

			expect(d.step()).toBeNull()
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Fan blocks notifications"
		it('says notifications are blocked and moves on at 「次へ」', async () => {
			const d = await render({ outcome: 'denied' })

			await d.press(t.notify.enable)

			expect(d.text('.post-signup-problem')).toBe(t.notify.blocked)
			expect(d.buttons()).toEqual([t.next])
			await d.press(t.next)
			expect(d.step()).toBe('install')
		})

		it('says it failed and moves on at 「次へ」 when registering fails', async () => {
			const d = await render({ outcome: 'failed', installed: true })

			await d.press(t.notify.enable)

			expect(d.text('.post-signup-problem')).toBe(t.notify.failed)
			await d.press(t.next)
			expect(d.step()).toBeNull()
		})

		it('moves on without a line when the prompt is closed', async () => {
			const d = await render({ outcome: 'default' })

			await d.press(t.notify.enable)

			expect(d.host.querySelector('.post-signup-problem')).toBeNull()
			expect(d.step()).toBe('install')
		})
	})

	describe('install step', () => {
		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Browser offers an install prompt"
		it('opens the browser install prompt and closes after it is answered', async () => {
			const d = await render({ permission: 'granted', nativePrompt: true })
			expect(d.text('.post-signup-title')).toBe(t.install.title)
			expect(d.text('.post-signup-body')).toBe(t.install.body)
			expect(d.host.querySelector('.post-signup-app-icon')).not.toBeNull()

			await d.press(t.install.add)

			expect(d.pwaInstall.install).toHaveBeenCalledTimes(1)
			expect(d.step()).toBeNull()
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "No install prompt available"
		it('shows the 3 browser-menu steps when the browser offers no prompt', async () => {
			const d = await render({ permission: 'granted', nativePrompt: false })

			await d.press(t.install.add)

			expect(d.pwaInstall.install).not.toHaveBeenCalled()
			const steps = [...d.host.querySelectorAll('.post-signup-steps li')].map(
				(li) => li.textContent,
			)
			expect(steps).toEqual([t.install.step1, t.install.step2, t.install.step3])
			expect(d.buttons()).toEqual([t.close])
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "App already installed"
		it('is not shown when the app is installed', async () => {
			const d = await render({ installed: true })

			expect(d.step()).toBe('notify')
			await d.press(t.defer)
			expect(d.step()).toBeNull()
		})
	})

	describe('iOS and iPadOS', () => {
		// @spec components/infrastructure/fan/web/global/post-signup-dialog "iPhone without the app installed"
		it('shows the add-to-home-screen steps instead, with no notification action', async () => {
			const d = await render({ ios: true, canReceivePush: false })

			expect(d.step()).toBe('iosGuide')
			expect(d.text('.post-signup-title')).toBe(t.notify.title)
			expect(d.text('.post-signup-body')).toBe(t.ios.body)
			const steps = [...d.host.querySelectorAll('.post-signup-steps li')].map(
				(li) => li.textContent,
			)
			expect(steps).toEqual([t.ios.step1, t.ios.step2, t.ios.step3])
			expect(d.buttons()).toEqual([t.defer])
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "iPhone with the app installed"
		it('shows the notification step in the app opened from the home screen', async () => {
			const d = await render({ ios: true, installed: true })

			expect(d.step()).toBe('notify')
			expect(d.buttons()).toEqual([t.notify.enable, t.defer])
		})
	})

	describe('locale', () => {
		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Title renders in active locale"
		it('shows the English title in English', async () => {
			const d = await render({ lng: 'en' })

			expect(d.text('.post-signup-title')).toBe(en.postSignup.notify.title)
			expect(d.text('.post-signup-title')).not.toBe(t.notify.title)
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "aria-label follows active locale"
		it('names the sheet in the active locale', async () => {
			const d = await render({ lng: 'en' })
			const i18n = d.fixture.container.get(I18N)

			const sheet = d.host.querySelector('bottom-sheet') as HTMLElement
			const label =
				sheet.getAttribute('aria-label') ??
				(CustomElement.for(sheet).viewModel as { ariaLabel?: string }).ariaLabel
			expect(label).toBe(en.postSignup.ariaLabel)
			expect(i18n.getLocale()).toBe('en')
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Translation key parity"
		it('has every Japanese string in English too', () => {
			const keys = (o: object, prefix = ''): string[] =>
				Object.entries(o).flatMap(([k, v]) =>
					typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
				)
			expect(keys(en.postSignup).sort()).toEqual(keys(ja.postSignup).sort())
		})
	})
})
