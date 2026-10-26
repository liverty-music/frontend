import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { Registration } from 'aurelia'
import { expect, fn, waitFor, within } from 'storybook/test'
import { BusyOnClickCustomAttribute } from '../../custom-attributes/busy-on-click'
import ja from '../../locales/ja/translation.json'
import { IFollowStore } from '../../services/follow-store'
import { INotificationManager } from '../../services/notification-manager'
import { IPromptCoordinator } from '../../services/prompt-coordinator'
import { IPushOfferService } from '../../services/push-offer-service'
import { IPwaInstallService } from '../../services/pwa-install-service'
import { PostSignupDialog } from './post-signup-dialog'

const t = ja.postSignup

interface Setup {
	permission: NotificationPermission
	ios: boolean
	installed: boolean
	followed: number
}

/** The sheet on a phone, with the services that decide its steps. */
function story(setup: Setup) {
	return defineAureliaStory({
		template: `
			<post-signup-dialog active.bind="true"></post-signup-dialog>
		`,
		register: [PostSignupDialog, BusyOnClickCustomAttribute],
		items: [
			Registration.instance(INotificationManager, {
				permission: setup.permission,
			}),
			Registration.instance(IPushOfferService, {
				canReceivePush: !setup.ios || setup.installed,
				accept: fn(async () => 'granted'),
			}),
			Registration.instance(IPwaInstallService, {
				canShowInstallOption: !setup.ios && !setup.installed,
				canShowFab: false,
				isIos: setup.ios,
				isInstalled: setup.installed,
				install: fn(async () => {}),
			}),
			Registration.instance(IPromptCoordinator, {
				isPostSignupSurfaceOpen: false,
			}),
			Registration.instance(IFollowStore, { followedCount: setup.followed }),
		],
	})
}

const meta = {
	title: 'Components/PostSignupDialog',
	component: PostSignupDialog,
	tags: ['test', 'autodocs'],
	// A phone; switch the viewport to see other sizes.
	globals: { viewport: { value: 'mobile1', isRotated: false } },
	// Shown as the app shows it: Japanese text under `lang="ja"`, which the
	// phrase-boundary line breaks need. Restored for the next story.
	beforeEach: () => {
		const lang = document.documentElement.lang
		document.documentElement.lang = 'ja'
		return () => {
			document.documentElement.lang = lang
		}
	},
} satisfies Meta<typeof PostSignupDialog>

export default meta
type Story = StoryObj<typeof meta>

/** The primary (filled) buttons of the shown step. */
function primaries(canvasElement: HTMLElement): HTMLButtonElement[] {
	return [
		...canvasElement.ownerDocument.querySelectorAll<HTMLButtonElement>(
			'.post-signup-actions button:not([data-variant])',
		),
	]
}

/**
 * Close the open sheet at the end of a test run. Chromium intermittently
 * crashes when a story's root is torn down with its sheet still open in the
 * top layer (see the PwaInstallBanner stories). Only under the test runner, so
 * the sheet stays open to look at in Storybook.
 */
function closeSheetsAfterTest(): void {
	if (import.meta.env.MODE !== 'test') return
	for (const el of document.querySelectorAll<HTMLElement>(':popover-open')) {
		el.hidePopover()
	}
}

async function expectTitle(canvasElement: HTMLElement, title: string) {
	const body = within(canvasElement.ownerDocument.body)
	const heading = await body.findByRole('heading', { name: title })
	// The sheet slides in; wait until it has.
	await waitFor(() => expect(heading).toBeVisible(), { timeout: 3000 })
	// Japanese wraps at phrase boundaries, with balanced lines.
	await expect(getComputedStyle(heading).textWrap).toContain('balance')
	return body
}

/** Step 1 for a fan who follows five artists. */
export const Notify = {
	render: () =>
		story({ permission: 'default', ios: false, installed: false, followed: 5 }),
	play: async ({ canvasElement }) => {
		const body = await expectTitle(canvasElement, t.notify.title)
		await expect(
			body.getByText(
				'フォロー中の5組のライブを探し始めました。見つかったら通知で届けます。',
			),
		).toBeVisible()
		const [primary, ...rest] = primaries(canvasElement)
		await expect(rest).toHaveLength(0)
		await expect(primary).toHaveTextContent(t.notify.enable)
		await expect(body.getByRole('button', { name: t.defer })).toBeVisible()
		closeSheetsAfterTest()
	},
} satisfies Story

/** Step 1 for a fan who follows no artist yet. */
export const NotifyNoFollows = {
	render: () =>
		story({ permission: 'default', ios: false, installed: false, followed: 0 }),
	play: async ({ canvasElement }) => {
		const body = await expectTitle(canvasElement, t.notify.title)
		await expect(body.getByText(t.notify.bodyNoFollows)).toBeVisible()
		closeSheetsAfterTest()
	},
} satisfies Story

/** Step 2 (notification already decided): add to the home screen. */
export const Install = {
	render: () =>
		story({ permission: 'granted', ios: false, installed: false, followed: 5 }),
	play: async ({ canvasElement }) => {
		const body = await expectTitle(canvasElement, t.install.title)
		await expect(body.getByText(t.install.body)).toBeVisible()
		const [primary, ...rest] = primaries(canvasElement)
		await expect(rest).toHaveLength(0)
		await expect(primary).toHaveTextContent(t.install.add)
		primary.click()
		await waitFor(() => expect(body.getByText(t.install.step1)).toBeVisible())
		closeSheetsAfterTest()
	},
} satisfies Story

/** iPhone in Safari: the add-to-home-screen steps, no notification action. */
export const IosGuide = {
	render: () =>
		story({ permission: 'default', ios: true, installed: false, followed: 5 }),
	play: async ({ canvasElement }) => {
		const body = await expectTitle(canvasElement, t.notify.title)
		await expect(body.getByText(t.ios.body)).toBeVisible()
		for (const step of [t.ios.step1, t.ios.step2, t.ios.step3]) {
			await expect(body.getByText(step)).toBeVisible()
		}
		await expect(primaries(canvasElement)).toHaveLength(0)
		await expect(
			body.queryByRole('button', { name: t.notify.enable }),
		).toBeNull()
		closeSheetsAfterTest()
	},
} satisfies Story
