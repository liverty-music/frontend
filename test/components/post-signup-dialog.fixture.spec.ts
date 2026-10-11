import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { PostSignupDialog } from '../../src/components/post-signup-dialog/post-signup-dialog'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import ja from '../../src/locales/ja/translation.json'
import { INotificationManager } from '../../src/services/notification-manager'
import { IPromptCoordinator } from '../../src/services/prompt-coordinator'
import { IPushService } from '../../src/services/push-service'
import { IPwaInstallService } from '../../src/services/pwa-install-service'

/**
 * Renders the real post-signup dialog template. The bottom sheet is a
 * pass-through stub (jsdom has no Popover API); its own open/dismiss behaviour
 * is covered by the bottom-sheet specs.
 */
const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<au-slot></au-slot>',
		bindables: ['open', 'ariaLabel'],
	},
	class {},
)

interface RenderOptions {
	permission: NotificationPermission
	installable: boolean
}

async function render({ permission, installable }: RenderOptions) {
	const fixture = await createFixture(
		'<post-signup-dialog active.bind="true"></post-signup-dialog>',
		class Host {},
		[
			I18nConfiguration.customize((o) => {
				o.initOptions = { lng: 'ja', resources: { ja: { translation: ja } } }
			}),
			PostSignupDialog,
			BottomSheetStub,
			BusyOnClickCustomAttribute,
			Registration.instance(INotificationManager, { permission }),
			Registration.instance(IPushService, { create: vi.fn() }),
			Registration.instance(IPwaInstallService, {
				canShowInstallOption: installable,
				canShowFab: installable,
				isIos: false,
				install: vi.fn(),
			}),
			Registration.instance(IPromptCoordinator, {
				markShown: vi.fn(),
				isPostSignupSurfaceOpen: false,
			}),
		],
	).started
	await tasksSettled()
	return fixture
}

function rowLabels(host: HTMLElement): string[] {
	return [...host.querySelectorAll('.post-signup-row-label')].map(
		(e) => e.textContent?.trim() ?? '',
	)
}

describe('PostSignupDialog (fixture)', () => {
	// @spec components/infrastructure/fan/web/global/post-signup-dialog "Dialog content leads with celebration"
	it('leads with the celebration, then offers the actions that still apply, with a footer dismiss', async () => {
		// Notification permission not yet requested; the app is installable.
		const fresh = await render({ permission: 'default', installable: true })
		const content = fresh.appHost.querySelector(
			'.post-signup-content',
		) as HTMLElement

		// The first content row is the celebration acknowledging onboarding.
		const first = content.firstElementChild as HTMLElement
		expect(first.classList.contains('post-signup-title')).toBe(true)
		expect(first.textContent?.trim()).toBe(ja.postSignup.title)

		// Notification opt-in and PWA install are offered.
		expect(rowLabels(fresh.appHost)).toEqual([
			ja.postSignup.notificationLabel,
			ja.postSignup.pwaLabel,
		])
		expect(fresh.appHost.textContent).toContain(
			ja.postSignup.notificationEnable,
		)
		expect(fresh.appHost.textContent).toContain(ja.postSignup.pwaInstall)
		expect(fresh.appHost.textContent).not.toContain(
			ja.postSignup.notificationDenied,
		)

		// The dismiss action sits in the footer.
		const dismiss = content.querySelector(
			'footer.post-signup-footer button',
		) as HTMLButtonElement
		expect(dismiss).not.toBeNull()
		expect(dismiss.textContent?.trim()).toBe(ja.postSignup.defer)
		await fresh.stop(true)

		// Permission denied and the app not installable: the denied message
		// replaces the opt-in, and no install row is shown.
		const denied = await render({ permission: 'denied', installable: false })
		const deniedContent = denied.appHost.querySelector(
			'.post-signup-content',
		) as HTMLElement
		expect(
			(deniedContent.firstElementChild as HTMLElement).textContent?.trim(),
		).toBe(ja.postSignup.title)
		expect(rowLabels(denied.appHost)).toEqual([
			ja.postSignup.notificationDenied,
		])
		expect(denied.appHost.textContent).not.toContain(
			ja.postSignup.notificationEnable,
		)
		expect(denied.appHost.textContent).not.toContain(ja.postSignup.pwaInstall)
		expect(
			deniedContent.querySelector('footer.post-signup-footer button'),
		).not.toBeNull()
		await denied.stop(true)
	})
})
