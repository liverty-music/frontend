import { INode, Registration } from 'aurelia'
import { beforeEach, describe, expect, it } from 'vitest'
import { SvgIcon } from '../../src/components/svg-icon/svg-icon'
import { createTestContainer } from '../helpers/create-container'

describe('SvgIcon', () => {
	let sut: SvgIcon
	let hostElement: HTMLElement

	function create(
		name = 'home',
		size: 'xs' | 'sm' | 'md' | 'lg' | 'xl' = 'md',
	): SvgIcon {
		hostElement = document.createElement('svg-icon')
		const container = createTestContainer(
			Registration.instance(INode, hostElement),
		)
		container.register(SvgIcon)
		const instance = container.get(SvgIcon)
		instance.name = name
		instance.size = size
		return instance
	}

	beforeEach(() => {
		sut = create()
	})

	it('should have default size of md', () => {
		expect(sut.size).toBe('md')
	})

	it('should set data-size attribute on host element when bound', () => {
		sut.bound()
		expect(hostElement.dataset.size).toBe('md')
	})

	it('should update data-size attribute when size changes', () => {
		sut.bound()
		sut.sizeChanged('lg')
		expect(hostElement.dataset.size).toBe('lg')
	})

	it('should accept name bindable', () => {
		sut = create('check')
		expect(sut.name).toBe('check')
	})

	it('should set initial size on host from bound', () => {
		sut = create('home', 'xl')
		sut.bound()
		expect(hostElement.dataset.size).toBe('xl')
	})
})
