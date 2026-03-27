import { createFixture } from '@aurelia/testing'
import { describe, expect, it } from 'vitest'
import { DotColorCustomAttribute } from '../../src/custom-attributes/dot-color'
import { TileColorCustomAttribute } from '../../src/custom-attributes/tile-color'

/**
 * createFixture integration tests for CSS bridge custom attributes.
 * Verifies attributes apply CSS custom properties when rendered
 * within an Aurelia template (per Aurelia 2 testing-attributes docs).
 *
 * Note: JSDOM does not expose CSS custom properties via getComputedStyle,
 * so we verify via element.style.getPropertyValue() instead of assertStyles().
 */

describe('TileColorCustomAttribute (fixture)', () => {
	it('applies --_tile-color CSS property via binding', async () => {
		const fixture = await createFixture
			.component(
				class App {
					color = '#ff00aa'
				},
			)
			.html('<div tile-color.bind="color"></div>')
			.deps(TileColorCustomAttribute)
			.build().started

		const el = fixture.getBy('div')
		expect(el.style.getPropertyValue('--_tile-color')).toBe('#ff00aa')
	})
})

describe('DotColorCustomAttribute (fixture)', () => {
	it('applies --_dot-color CSS property via binding', async () => {
		const fixture = await createFixture
			.component(
				class App {
					color = 'oklch(70% 0.2 120)'
				},
			)
			.html('<div dot-color.bind="color"></div>')
			.deps(DotColorCustomAttribute)
			.build().started

		const el = fixture.getBy('div')
		expect(el.style.getPropertyValue('--_dot-color')).toBe('oklch(70% 0.2 120)')
	})
})
