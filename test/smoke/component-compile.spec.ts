import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { createFixture } from '@aurelia/testing'
import { IEventAggregator, Registration } from 'aurelia'
import { describe, it, vi } from 'vitest'
import { BottomNavBar } from '../../src/components/bottom-nav-bar/bottom-nav-bar'
import { StatePlaceholder } from '../../src/components/state-placeholder/state-placeholder'
import { SvgIcon } from '../../src/components/svg-icon/svg-icon'
import { IErrorBoundaryService } from '../../src/services/error-boundary-service'
import { IOnboardingService } from '../../src/services/onboarding-service'
import { createMockErrorBoundary } from '../helpers/mock-error-boundary'
import { createMockI18n } from '../helpers/mock-i18n'
import { createMockRouter } from '../helpers/mock-router'

/**
 * Smoke tests that mount each globally-registered custom element via
 * createFixture() to verify template compilation and basic rendering.
 *
 * These catch AUR0703-class errors (invalid template controller usage,
 * malformed bindings, etc.) that only surface at runtime due to
 * Aurelia 2's JIT compilation model.
 *
 * Uses the fluent builder API and official fixture assertions per
 * Aurelia 2 testing docs (https://docs.aurelia.io/developer-guides/overview/testing-components).
 *
 * Excluded components:
 * - dna-orb: Requires HTMLCanvasElement.getContext() which JSDOM does not support.
 *
 * Note: ILogger is NOT registered here — createFixture's TestContext
 * provides its own logger with the required .root.config structure.
 */

const sharedRegistrations = [
	Registration.instance(IRouter, createMockRouter()),
	Registration.instance(I18N, createMockI18n()),
	Registration.instance(IEventAggregator, {
		publish: vi.fn(),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
	}),
	Registration.instance(IErrorBoundaryService, createMockErrorBoundary()),
	Registration.instance(IOnboardingService, {
		currentStep: 'completed',
		isComplete: true,
		completeStep: vi.fn(),
		goToStep: vi.fn(),
	}),
]

describe('Component template compilation smoke tests', () => {
	it('SvgIcon compiles and renders with data-size attribute', async () => {
		const fixture = await createFixture
			.html('<svg-icon name="home" size="lg"></svg-icon>')
			.deps(...sharedRegistrations, SvgIcon)
			.build().started

		fixture.assertAttr('svg-icon', 'data-size', 'lg')
	})

	it('StatePlaceholder compiles and renders section', async () => {
		const fixture = await createFixture
			.html('<state-placeholder icon="search"></state-placeholder>')
			.deps(...sharedRegistrations, StatePlaceholder, SvgIcon)
			.build().started

		fixture.getBy('.state-center')
	})

	it('BottomNavBar compiles and renders nav element', async () => {
		const fixture = await createFixture
			.html('<bottom-nav-bar></bottom-nav-bar>')
			.deps(...sharedRegistrations, BottomNavBar, SvgIcon)
			.build().started

		fixture.getBy('.nav-bar')
	})
})
