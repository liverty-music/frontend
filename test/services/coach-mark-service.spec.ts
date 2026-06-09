import { DI, ILogger, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	type CoachMarkService,
	ICoachMarkService,
} from '../../src/services/coach-mark-service'
import { createMockLogger } from '../helpers/mock-logger'

function createService(): CoachMarkService {
	const container = DI.createContainer()
	container.register(Registration.instance(ILogger, createMockLogger()))
	container.register(ICoachMarkService)
	return container.get(ICoachMarkService)
}

describe('CoachMarkService', () => {
	let sut: CoachMarkService

	beforeEach(() => {
		sut = createService()
	})

	it('defaults to inactive with empty state', () => {
		expect(sut.active).toBe(false)
		expect(sut.target).toBe('')
		expect(sut.message).toBe('')
		expect(sut.onTap).toBeUndefined()
	})

	it('activate sets the spotlight state', () => {
		const onTap = vi.fn()
		sut.activate('[data-nav="home"]', 'View your timetable', onTap, '50%')

		expect(sut.active).toBe(true)
		expect(sut.target).toBe('[data-nav="home"]')
		expect(sut.message).toBe('View your timetable')
		expect(sut.radius).toBe('50%')
		expect(sut.onTap).toBe(onTap)
	})

	it('activate falls back to the default radius', () => {
		sut.activate('[data-nav="home"]', 'msg')
		expect(sut.radius).toBe('12px')
		expect(sut.onTap).toBeUndefined()
	})

	it('deactivate clears all spotlight state', () => {
		sut.activate('[data-nav="home"]', 'msg', vi.fn(), '50%')
		sut.deactivate()

		expect(sut.active).toBe(false)
		expect(sut.target).toBe('')
		expect(sut.message).toBe('')
		expect(sut.radius).toBe('12px')
		expect(sut.onTap).toBeUndefined()
	})

	it('honors a single active coach mark by overwriting on re-activate', () => {
		sut.activate('[data-nav="home"]', 'first')
		sut.activate('[data-stage="home"]', 'second', undefined, '8px')

		expect(sut.target).toBe('[data-stage="home"]')
		expect(sut.message).toBe('second')
		expect(sut.radius).toBe('8px')
		expect(sut.active).toBe(true)
	})
})
