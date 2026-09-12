import { describe, expect, it } from 'vitest'
import { PageHeaderState, type PageIdentity } from './page-header-state'

const dashboard: PageIdentity = {
	titleKey: 'nav.home',
	morphTitle: true,
	activePath: 'dashboard',
}
const settings: PageIdentity = {
	titleKey: 'nav.settings',
	morphTitle: false,
	activePath: 'settings',
}

describe('PageHeaderState', () => {
	it('setOptimistic applies the target identity immediately', () => {
		const sut = new PageHeaderState()

		sut.setOptimistic(settings)

		expect(sut.titleKey).toBe('nav.settings')
		expect(sut.morphTitle).toBe(false)
		expect(sut.activePath).toBe('settings')
	})

	it('confirm overrides the optimistic value with the authoritative one', () => {
		const sut = new PageHeaderState()

		// Optimistic guess (e.g. an empty redirect target), then the reconciled route.
		sut.setOptimistic({ titleKey: '', morphTitle: false, activePath: '' })
		sut.confirm(dashboard)

		expect(sut.titleKey).toBe('nav.home')
		expect(sut.morphTitle).toBe(true)
		expect(sut.activePath).toBe('dashboard')
	})

	it('rollback restores the last confirmed identity', () => {
		const sut = new PageHeaderState()
		sut.confirm(dashboard)

		// A subsequent navigation optimistically switches, then fails.
		sut.setOptimistic(settings)
		sut.rollback()

		expect(sut.titleKey).toBe('nav.home')
		expect(sut.morphTitle).toBe(true)
		expect(sut.activePath).toBe('dashboard')
	})

	it('rollback before any confirm restores the empty initial identity', () => {
		const sut = new PageHeaderState()

		sut.setOptimistic(settings)
		sut.rollback()

		expect(sut.titleKey).toBe('')
		expect(sut.morphTitle).toBe(false)
		expect(sut.activePath).toBe('')
	})

	it('setTitle updates the title and morph flag in place', () => {
		const sut = new PageHeaderState()
		sut.confirm(dashboard)

		sut.setTitle('allNearby.modeTitle', { morph: true })

		expect(sut.titleKey).toBe('allNearby.modeTitle')
		expect(sut.morphTitle).toBe(true)
		// The active path is untouched by an in-place title change.
		expect(sut.activePath).toBe('dashboard')
	})

	it('setTitle defaults morph to false when omitted', () => {
		const sut = new PageHeaderState()
		sut.confirm(dashboard)

		sut.setTitle('allNearby.modeTitle')

		expect(sut.morphTitle).toBe(false)
	})

	it('a dynamic title survives a later rollback', () => {
		const sut = new PageHeaderState()
		sut.confirm(dashboard)
		sut.setTitle('allNearby.modeTitle', { morph: true })

		// A navigation away starts optimistically, then errors.
		sut.setOptimistic(settings)
		sut.rollback()

		expect(sut.titleKey).toBe('allNearby.modeTitle')
		expect(sut.morphTitle).toBe(true)
		expect(sut.activePath).toBe('dashboard')
	})
})
