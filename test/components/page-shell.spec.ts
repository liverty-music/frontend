import { INode, Registration } from 'aurelia'
import { beforeEach, describe, expect, it } from 'vitest'
import { PageShell } from '../../src/components/page-shell/page-shell'
import { createTestContainer } from '../helpers/create-container'

describe('PageShell', () => {
	let sut: PageShell

	function create(titleKey = '', showHeader = true): PageShell {
		const hostElement = document.createElement('page-shell')
		const container = createTestContainer(
			Registration.instance(INode, hostElement),
		)
		container.register(PageShell)
		const instance = container.get(PageShell)
		instance.titleKey = titleKey
		instance.showHeader = showHeader
		return instance
	}

	beforeEach(() => {
		sut = create()
	})

	it('should have showHeader true by default', () => {
		expect(sut.showHeader).toBe(true)
	})

	it('should have empty titleKey by default', () => {
		expect(sut.titleKey).toBe('')
	})

	it('should accept titleKey bindable', () => {
		sut = create('nav.myArtists')
		expect(sut.titleKey).toBe('nav.myArtists')
	})

	it('should accept showHeader false', () => {
		sut = create('', false)
		expect(sut.showHeader).toBe(false)
	})
})
