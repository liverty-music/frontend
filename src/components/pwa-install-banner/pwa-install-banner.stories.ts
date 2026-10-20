import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { Registration } from 'aurelia'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
	expectBannerMessage,
	expectBannerMotion,
	expectBannerOffset,
	expectBannerSurface,
	expectCompactFilledButton,
	expectOneRow,
} from '../../../.storybook/bottom-banner'
import { BusyOnClickCustomAttribute } from '../../custom-attributes/busy-on-click'
import ja from '../../locales/ja/translation.json'
import { IPwaInstallService } from '../../services/pwa-install-service'
import { PwaInstallBanner } from './pwa-install-banner'

// The banner reads whether to show and which CTA to offer from the install
// service; a stand-in shows it in guide mode (no captured install prompt).
function mockPwaInstall(shouldShowInstallBanner = true) {
	return {
		isIos: false,
		canShowFab: false,
		shouldShowInstallBanner,
		install: fn(async () => {}),
		confirmInstalled: fn(),
	}
}

const meta = {
	title: 'Components/PwaInstallBanner',
	component: PwaInstallBanner,
	tags: ['test', 'autodocs'],
} satisfies Meta<typeof PwaInstallBanner>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The app is installed: the banner leaves the DOM and the tab order. Kept
 * before Visible, which ends with the guide sheet's modal <dialog> open:
 * Chromium intermittently crashes when another story renders after it.
 */
export const Hidden = {
	render: () =>
		defineAureliaStory({
			template: '<pwa-install-banner></pwa-install-banner>',
			register: [PwaInstallBanner, BusyOnClickCustomAttribute],
			items: [Registration.instance(IPwaInstallService, mockPwaInstall(false))],
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/pwa-install-banner "Banner is removed from DOM when hidden"
		await expect(canvasElement.querySelector('pwa-install-banner')).not.toBe(
			null,
		)
		await expect(canvasElement.querySelector('.pwa-banner')).toBe(null)
		await expect(within(canvasElement).queryAllByRole('button')).toHaveLength(0)
	},
} satisfies Story

/**
 * A signed-in fan's banner after onboarding. Tagged `reduced-motion`, so it
 * also runs with motion reduced and asserts the motion that matches the
 * preference.
 */
export const Visible = {
	tags: ['reduced-motion'],
	render: () =>
		defineAureliaStory({
			template: '<pwa-install-banner></pwa-install-banner>',
			register: [PwaInstallBanner, BusyOnClickCustomAttribute],
			items: [Registration.instance(IPwaInstallService, mockPwaInstall())],
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const host = canvasElement.querySelector<HTMLElement>('pwa-install-banner')
		const surface = canvasElement.querySelector<HTMLElement>('.pwa-banner')
		const label = canvasElement.querySelector<HTMLElement>('.pwa-banner-label')
		if (!host || !surface || !label) throw new Error('no banner')
		const t = ja.pwaInstallBanner
		const action = canvas.getByRole('button', { name: t.cta })

		// @spec components/infrastructure/fan/web/global/pwa-install-banner "PWA install prompt displays localized text"
		// @spec components/infrastructure/fan/web/global/pwa-install-banner "Banner element has an accessible label"
		await expect(surface.tagName).toBe('ASIDE')
		await expect(surface.getAttribute('aria-label')).toBe(t.ariaLabel)
		await expect(label.textContent).toBe(t.label)

		// @spec components/infrastructure/fan/web/global/pwa-install-banner "Banner is fixed at the bottom above the nav bar"
		await expect(getComputedStyle(host).position).toBe('fixed')
		await expectBannerOffset(host)
		await expect(host.getBoundingClientRect().left).toBe(0)
		await expect(host.getBoundingClientRect().width).toBe(
			document.documentElement.clientWidth,
		)

		// @spec components/infrastructure/fan/web/global/pwa-install-banner "One row with no icon or close control"
		await expectOneRow(surface, label, action)

		// @spec components/infrastructure/fan/web/global/pwa-install-banner "Banner frosted glass and gradient border"
		await expectBannerSurface(surface)

		// @spec components/infrastructure/fan/web/global/pwa-install-banner "Install button is the filled compact button"
		// @spec components/infrastructure/fan/web/global/ui-primitives "Compact filled button on a bottom banner"
		await expectCompactFilledButton(action, label)

		// @spec components/infrastructure/fan/web/global/pwa-install-banner "Banner message text"
		await expectBannerMessage(label, surface)

		// @spec components/infrastructure/fan/web/global/pwa-install-banner "CTA attention cue"
		// @spec components/infrastructure/fan/web/global/pwa-install-banner "Reduced motion — no animation"
		// @spec components/infrastructure/fan/web/global/pwa-install-banner "Banner slides in on appearance"
		await expectBannerMotion(surface, action)

		// @spec components/infrastructure/fan/web/global/pwa-install-banner "PWA install prompt displays localized text"
		// In guide mode the CTA opens the guide sheet, whose text is localized too.
		await userEvent.click(action)
		const sheet = within(document.body)
		await waitFor(() =>
			expect(
				sheet.getByRole('heading', { name: t.guideTitle }),
			).toBeInTheDocument(),
		)
		for (const step of [t.chromeStep1, t.chromeStep2, t.chromeStep3]) {
			await expect(sheet.getByText(step)).toBeInTheDocument()
		}
		await expect(
			sheet.getByRole('button', { name: t.guideConfirm }),
		).toBeInTheDocument()
	},
} satisfies Story
