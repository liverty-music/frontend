import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, IEventAggregator, Registration } from 'aurelia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Snack } from '../../shared/ui/snack-bar/snack'
import type { Notification } from '../../src/entities/notification'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { NotificationsRoute } from '../../src/routes/notifications/notifications-route'
import { IAuthService } from '../../src/services/auth-service'
import { INotificationStore } from '../../src/services/notification-store'

const NOW = new Date('2026-11-07T12:00:00Z')

function notification(init: Partial<Notification>): Notification {
	return {
		id: 'n-1',
		title: '[ヨルシカ] 抽選結果のお知らせ',
		body: '11/20のぴあアリーナMM公演のチケット抽選が落選となりました。\n前世 2026',
		link: '/tickets',
		createTime: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
		...init,
	}
}

const mounted: { stop: (dispose?: boolean) => unknown }[] = []

async function render(
	state: {
		state?: 'loading' | 'ready' | 'error'
		notifications?: readonly Notification[]
		isAuthenticated?: boolean
	},
	lng: 'ja' | 'en' = 'ja',
) {
	const store = {
		state: state.state ?? 'ready',
		notifications: state.notifications ?? [],
		refresh: vi.fn(async () => {}),
		markRead: vi.fn(async () => {}),
	}
	const router = { load: vi.fn(async () => true) }
	const fixture = await createFixture
		.html('<notifications-route></notifications-route>')
		.deps(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng,
					resources: { ja: { translation: ja }, en: { translation: en } },
					fallbackLng: 'ja',
				}
			}),
			Registration.instance(INotificationStore, store),
			Registration.instance(IRouter, router),
			Registration.instance(IAuthService, {
				isAuthenticated: state.isAuthenticated ?? true,
				ready: Promise.resolve(),
			}),
			NotificationsRoute,
		)
		.build().started
	mounted.push(fixture)
	await tasksSettled()
	const host = fixture.appHost
	const items = () => [
		...host.querySelectorAll<HTMLButtonElement>(
			'[data-testid="notifications-item"]',
		),
	]
	const vm = CustomElement.for<NotificationsRoute>(
		host.querySelector('notifications-route') as HTMLElement,
	).viewModel
	const ea = fixture.container.get(IEventAggregator)
	return { store, router, host, items, vm, ea }
}

describe('NotificationsRoute', () => {
	afterEach(async () => {
		vi.useRealTimers()
		for (const fixture of mounted.splice(0)) await fixture.stop(true)
	})

	// @spec components/infrastructure/fan/web/route/notifications "Notifications listed"
	it('lists the notifications in order, marking unread ones and dimming read ones', async () => {
		vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
		const { items } = await render({
			notifications: [
				notification({ id: 'newest', title: '[A] newest' }),
				notification({ id: 'read', title: '[A] read', readTime: NOW }),
				notification({ id: 'oldest', title: '[A] oldest' }),
			],
		})

		const shown = items()
		expect(
			shown.map(
				(i) => i.querySelector('.notifications-item-title')?.textContent,
			),
		).toEqual(['[A] newest', '[A] read', '[A] oldest'])
		expect(shown.map((i) => i.getAttribute('data-read'))).toEqual([
			'false',
			'true',
			'false',
		])
		expect(
			shown.map(
				(i) => i.querySelector('[data-testid="notifications-unread"]') !== null,
			),
		).toEqual([true, false, true])
	})

	it('keeps the line break of the body', async () => {
		const { items } = await render({ notifications: [notification({})] })

		const body = items()[0].querySelector('.notifications-item-body')
		expect(body?.textContent).toContain('\n前世 2026')
	})

	it('shows the sent time relative to now for 24 hours and as month/day before that', async () => {
		vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
		const time = (i: HTMLElement) =>
			i.querySelector('.notifications-item-time')?.textContent
		const notifications = [
			notification({ id: 'a' }),
			notification({
				id: 'b',
				createTime: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
			}),
		]

		const ja = await render({ notifications })
		expect(time(ja.items()[0])).toBe('2時間前')
		expect(time(ja.items()[1])).toBe('11/6')

		const english = await render({ notifications }, 'en')
		expect(time(english.items()[0])).toBe('2 hours ago')
	})

	// @spec components/infrastructure/fan/web/route/notifications "Empty"
	it('says there is no notification yet', async () => {
		const { host } = await render({ notifications: [] })

		expect(
			host.querySelector('[data-testid="notifications-empty"]')?.textContent,
		).toBe('通知はまだありません。')
	})

	it('offers a retry when the list cannot be loaded', async () => {
		const { host, store } = await render({ state: 'error' })

		host
			.querySelector<HTMLButtonElement>(
				'[data-testid="notifications-error"] button',
			)
			?.click()

		expect(store.refresh).toHaveBeenCalledTimes(1)
	})

	// @spec components/infrastructure/fan/web/route/notifications "Tap an unread item"
	it('marks the tapped item read and opens its link', async () => {
		const { items, store, router } = await render({
			notifications: [notification({ id: 'win', link: '/tickets' })],
		})

		items()[0].click()

		expect(store.markRead).toHaveBeenCalledWith('win')
		expect(router.load).toHaveBeenCalledWith('/tickets')
	})

	// @spec components/infrastructure/fan/web/route/notifications "Guest"
	it('sends a guest to the welcome page with a notice', async () => {
		const { vm, ea } = await render({ isAuthenticated: false })
		const snacks: Snack[] = []
		ea.subscribe(Snack, (snack) => {
			snacks.push(snack)
		})

		expect(await vm.canLoad()).toBe('/welcome')
		expect(snacks).toHaveLength(1)
		expect(snacks[0].message).toBe('通知を見るにはログインが必要です。')
	})

	it('lets a signed-in fan in', async () => {
		const { vm } = await render({})

		expect(await vm.canLoad()).toBe(true)
	})
})
