import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { describe, expect, it, vi } from 'vitest'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import { WelcomeCta } from '../../src/routes/welcome/welcome-cta'

describe('welcome-cta', () => {
	it.each([
		['welcome-get-started', 'get-started'],
		['welcome-login', 'login'],
	])(
		'the %s button asks the parent with a %s event and stays busy until the parent settles',
		async (testId, eventName) => {
			let settle: () => void = () => {}
			const handler = vi.fn((event: CustomEvent) =>
				event.detail.waitUntil(
					new Promise<void>((resolve) => {
						settle = resolve
					}),
				),
			)
			const fixture = await createFixture
				.html(
					`<welcome-cta ${eventName}.trigger="handler($event)"></welcome-cta>`,
				)
				.component(
					class {
						public handler = handler
					},
				)
				.deps(WelcomeCta, BusyOnClickCustomAttribute)
				.build().started
			await tasksSettled()

			const button = fixture.appHost.querySelector<HTMLElement>(
				`[data-testid="${testId}"]`,
			)
			button?.click()
			expect(handler).toHaveBeenCalledTimes(1)
			expect(button?.hasAttribute('data-busy')).toBe(true)
			settle()
			await new Promise((r) => setTimeout(r, 0))
			expect(button?.hasAttribute('data-busy')).toBe(false)
		},
	)

	it('does not go busy when no parent waits', async () => {
		const fixture = await createFixture
			.html('<welcome-cta></welcome-cta>')
			.component(class {})
			.deps(WelcomeCta, BusyOnClickCustomAttribute)
			.build().started
		await tasksSettled()
		const button = fixture.appHost.querySelector<HTMLElement>(
			'[data-testid="welcome-login"]',
		)
		button?.click()
		expect(button?.hasAttribute('data-busy')).toBe(false)
	})
})
