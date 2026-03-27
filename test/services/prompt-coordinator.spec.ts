// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { PromptCoordinator } from '../../src/services/prompt-coordinator'

describe('PromptCoordinator', () => {
	it('should return true for canShowPrompt initially', () => {
		const sut = new PromptCoordinator()
		expect(sut.canShowPrompt('notification')).toBe(true)
		expect(sut.canShowPrompt('pwa-install')).toBe(true)
	})

	it('should return false after markShown is called for the same type', () => {
		const sut = new PromptCoordinator()
		sut.markShown('notification')
		expect(sut.canShowPrompt('notification')).toBe(false)
	})

	it('should return false for any type after another type is marked shown', () => {
		const sut = new PromptCoordinator()
		sut.markShown('notification')
		expect(sut.canShowPrompt('pwa-install')).toBe(false)
	})

	it('should return false for the originally shown type too', () => {
		const sut = new PromptCoordinator()
		sut.markShown('pwa-install')
		expect(sut.canShowPrompt('pwa-install')).toBe(false)
		expect(sut.canShowPrompt('notification')).toBe(false)
	})
})
