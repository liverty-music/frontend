import { DI, ILogger, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '../helpers/mock-logger'

const { SignupPromptBanner } = await import(
	'../../src/components/signup-prompt-banner/signup-prompt-banner'
)

function createBannerWithHost() {
	const hostElement = document.createElement('div')
	document.body.appendChild(hostElement)

	const container = DI.createContainer()
	container.register(Registration.instance(ILogger, createMockLogger()))
	container.register(Registration.instance(INode, hostElement))

	const sut = container.invoke(SignupPromptBanner)

	return { sut, hostElement }
}

describe('SignupPromptBanner', () => {
	let sut: InstanceType<typeof SignupPromptBanner>
	let hostElement: HTMLElement

	beforeEach(() => {
		const result = createBannerWithHost()
		sut = result.sut
		hostElement = result.hostElement
	})

	afterEach(() => {
		if (hostElement?.parentNode) {
			document.body.removeChild(hostElement)
		}
	})

	describe('visibility', () => {
		it('should have visible set to false by default', () => {
			expect(sut.visible).toBe(false)
		})

		it('should accept visible set to true', () => {
			sut.visible = true
			expect(sut.visible).toBe(true)
		})

		// Note: The actual DOM rendering (if.bind="visible") is handled by Aurelia's
		// template engine. In a unit test without the full rendering pipeline, we verify
		// the bindable property value. The template conditionally renders based on this.
	})

	describe('onSignup', () => {
		it('should dispatch signup-requested event when signup is clicked', () => {
			const handler = vi.fn()
			hostElement.addEventListener('signup-requested', handler)

			sut.onSignup()

			expect(handler).toHaveBeenCalledTimes(1)
			const event = handler.mock.calls[0][0] as CustomEvent
			expect(event.bubbles).toBe(true)
		})
	})
})
