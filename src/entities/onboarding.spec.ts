// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
	isCompleted,
	isOnboarding,
	normalizeStep,
	stepIndex,
} from './onboarding'

describe('stepIndex', () => {
	it('returns correct ordinal for each step', () => {
		expect(stepIndex('lp')).toBe(0)
		expect(stepIndex('discovery')).toBe(1)
		expect(stepIndex('dashboard')).toBe(2)
		expect(stepIndex('my-artists')).toBe(3)
		expect(stepIndex('completed')).toBe(4)
	})
})

describe('isOnboarding', () => {
	it('returns true for active onboarding steps', () => {
		expect(isOnboarding('discovery')).toBe(true)
		expect(isOnboarding('dashboard')).toBe(true)
		expect(isOnboarding('my-artists')).toBe(true)
	})

	it('returns false for terminal steps', () => {
		expect(isOnboarding('lp')).toBe(false)
		expect(isOnboarding('completed')).toBe(false)
	})
})

describe('isCompleted', () => {
	it('returns true for completed step', () => {
		expect(isCompleted('completed')).toBe(true)
	})

	it('returns false for non-completed steps', () => {
		expect(isCompleted('dashboard')).toBe(false)
		expect(isCompleted('lp')).toBe(false)
	})
})

describe('normalizeStep', () => {
	it.each<[string, string]>([
		['0', 'lp'],
		['1', 'discovery'],
		['3', 'dashboard'],
		['4', 'my-artists'],
		['5', 'my-artists'],
		['7', 'completed'],
	])('maps legacy numeric %s to %s', (input, expected) => {
		expect(normalizeStep(input)).toBe(expected)
	})

	it.each(['2', '6'])('falls back to lp for unmapped numeric %s', (input) => {
		expect(normalizeStep(input)).toBe('lp')
	})

	it('migrates removed "detail" step to "dashboard"', () => {
		expect(normalizeStep('detail')).toBe('dashboard')
	})

	it('passes through valid string steps', () => {
		expect(normalizeStep('dashboard')).toBe('dashboard')
		expect(normalizeStep('completed')).toBe('completed')
		expect(normalizeStep('my-artists')).toBe('my-artists')
	})

	it('falls back to lp for unknown values', () => {
		expect(normalizeStep('invalid')).toBe('lp')
		expect(normalizeStep('')).toBe('lp')
	})
})
