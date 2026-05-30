import { createFixture } from '@aurelia/testing'
import { customElement } from 'aurelia'
import { describe, expect, it } from 'vitest'

/**
 * Guards the lifecycle-ordering invariant that the My Artists onboarding
 * completion depends on.
 *
 * `my-artists-route.attached()` sets `onboardingStep` to COMPLETED on arrival,
 * which flips `isOnboarding` to false. The `<page-help>` child auto-opens in its
 * OWN `attached()` only while `isOnboarding` is still true. This works because
 * Aurelia 2 runs `attached` bottom-up (children before parents) — so PageHelp
 * observes the pre-completion state and still auto-opens.
 *
 * This test pins that framework guarantee with minimal stand-ins for the two
 * components: if Aurelia ever reversed the order, the child would see
 * `isOnboarding=false` and the assertion would fail, flagging the regression.
 */
describe('attach order: child before parent (PageHelp vs my-artists completion)', () => {
	const record = { events: [] as string[], isOnboarding: true }

	@customElement({ name: 'lc-child', template: '<i></i>' })
	class LcChild {
		// Stand-in for PageHelp.attached() reading onboarding state.
		attached(): void {
			record.events.push(`child saw isOnboarding=${record.isOnboarding}`)
		}
	}

	@customElement({ name: 'lc-parent', template: '<lc-child></lc-child>' })
	class LcParent {
		// Stand-in for my-artists-route.attached() completing onboarding.
		attached(): void {
			record.isOnboarding = false
			record.events.push('parent completed onboarding')
		}
	}

	it('runs child attached before parent attached', async () => {
		record.events = []
		record.isOnboarding = true

		await createFixture
			.component(class App {})
			.html('<lc-parent></lc-parent>')
			.deps(LcParent, LcChild)
			.build().started

		expect(record.events).toEqual([
			'child saw isOnboarding=true',
			'parent completed onboarding',
		])
	})
})
