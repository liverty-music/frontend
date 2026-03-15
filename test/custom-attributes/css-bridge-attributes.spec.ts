import { DI, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DotColorCustomAttribute } from '../../src/custom-attributes/dot-color'
import { SpotlightRadiusCustomAttribute } from '../../src/custom-attributes/spotlight-radius'
import { TileColorCustomAttribute } from '../../src/custom-attributes/tile-color'

function createAttribute<T>(Ctor: new (...args: any[]) => T) {
	const el = document.createElement('div')
	document.body.appendChild(el)

	const container = DI.createContainer()
	container.register(Registration.instance(INode, el))

	const sut = container.invoke(Ctor) as T
	return { sut, el }
}

describe('TileColorCustomAttribute', () => {
	let sut: TileColorCustomAttribute
	let el: HTMLElement

	beforeEach(() => {
		const result = createAttribute(TileColorCustomAttribute)
		sut = result.sut
		el = result.el
	})

	afterEach(() => {
		el.remove()
	})

	it('sets --_tile-color when value is non-empty', () => {
		sut.value = '#ff00aa'
		sut.bound()
		expect(el.style.getPropertyValue('--_tile-color')).toBe('#ff00aa')
	})

	it('removes --_tile-color when value is empty', () => {
		sut.value = '#ff00aa'
		sut.bound()
		sut.value = ''
		sut.valueChanged()
		expect(el.style.getPropertyValue('--_tile-color')).toBe('')
	})

	it('removes --_tile-color on detaching', () => {
		sut.value = '#abc'
		sut.bound()
		sut.detaching()
		expect(el.style.getPropertyValue('--_tile-color')).toBe('')
	})
})

describe('DotColorCustomAttribute', () => {
	let sut: DotColorCustomAttribute
	let el: HTMLElement

	beforeEach(() => {
		const result = createAttribute(DotColorCustomAttribute)
		sut = result.sut
		el = result.el
	})

	afterEach(() => {
		el.remove()
	})

	it('sets --_dot-color when value is non-empty', () => {
		sut.value = 'oklch(70% 0.2 120)'
		sut.bound()
		expect(el.style.getPropertyValue('--_dot-color')).toBe('oklch(70% 0.2 120)')
	})

	it('removes --_dot-color when value is empty', () => {
		sut.value = '#red'
		sut.bound()
		sut.value = ''
		sut.valueChanged()
		expect(el.style.getPropertyValue('--_dot-color')).toBe('')
	})

	it('removes --_dot-color on detaching', () => {
		sut.value = '#123'
		sut.bound()
		sut.detaching()
		expect(el.style.getPropertyValue('--_dot-color')).toBe('')
	})
})

describe('SpotlightRadiusCustomAttribute', () => {
	let sut: SpotlightRadiusCustomAttribute
	let el: HTMLElement

	beforeEach(() => {
		const result = createAttribute(SpotlightRadiusCustomAttribute)
		sut = result.sut
		el = result.el
	})

	afterEach(() => {
		el.remove()
	})

	it('sets --spotlight-radius with default value on bound', () => {
		sut.bound()
		expect(el.style.getPropertyValue('--spotlight-radius')).toBe('12px')
	})

	it('updates --spotlight-radius on valueChanged', () => {
		sut.value = '24px'
		sut.valueChanged()
		expect(el.style.getPropertyValue('--spotlight-radius')).toBe('24px')
	})

	it('removes --spotlight-radius on detaching', () => {
		sut.bound()
		sut.detaching()
		expect(el.style.getPropertyValue('--spotlight-radius')).toBe('')
	})
})
