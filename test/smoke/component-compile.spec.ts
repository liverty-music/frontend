import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { createFixture } from '@aurelia/testing'
import { IEventAggregator, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
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
 * createFixture() to verify template compilation succeeds.
 *
 * These catch AUR0703-class errors (invalid template controller usage,
 * malformed bindings, etc.) that only surface at runtime due to
 * Aurelia 2's JIT compilation model.
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
		currentStep: 7,
		isComplete: true,
		completeStep: vi.fn(),
		goToStep: vi.fn(),
	}),
]

const components: [string, string, object, object[]][] = [
	['SvgIcon', '<svg-icon name="home"></svg-icon>', SvgIcon, []],
	[
		'StatePlaceholder',
		'<state-placeholder></state-placeholder>',
		StatePlaceholder,
		[],
	],
	[
		'BottomNavBar',
		'<bottom-nav-bar></bottom-nav-bar>',
		BottomNavBar,
		[SvgIcon],
	],
]

describe('Component template compilation smoke tests', () => {
	it.each(
		components,
	)('%s compiles without error', async (_name, template, Component, deps) => {
		const { tearDown } = await createFixture(template, {}, [
			...sharedRegistrations,
			Component,
			...deps,
		]).started

		expect(true).toBe(true)
		await tearDown()
	})
})
