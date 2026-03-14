import { INode, Registration } from 'aurelia'
import { beforeEach, describe, expect, it } from 'vitest'
import { StatePlaceholder } from '../../src/components/state-placeholder/state-placeholder'
import { createTestContainer } from '../helpers/create-container'

describe('StatePlaceholder', () => {
	let sut: StatePlaceholder

	function create(
		icon = '',
		title = '',
		description = '',
		ctaLabel = '',
	): StatePlaceholder {
		const hostElement = document.createElement('state-placeholder')
		const container = createTestContainer(
			Registration.instance(INode, hostElement),
		)
		container.register(StatePlaceholder)
		const instance = container.get(StatePlaceholder)
		instance.icon = icon
		instance.title = title
		instance.description = description
		instance.ctaLabel = ctaLabel
		return instance
	}

	beforeEach(() => {
		sut = create()
	})

	it('should have empty defaults', () => {
		expect(sut.icon).toBe('')
		expect(sut.title).toBe('')
		expect(sut.description).toBe('')
		expect(sut.ctaLabel).toBe('')
	})

	it('should accept bindable props', () => {
		sut = create('ticket', 'No tickets', 'Your tickets appear here', 'Browse')
		expect(sut.icon).toBe('ticket')
		expect(sut.title).toBe('No tickets')
		expect(sut.description).toBe('Your tickets appear here')
		expect(sut.ctaLabel).toBe('Browse')
	})
})
