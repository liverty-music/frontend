// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { AbsorptionAnimator } from './absorption-animator'

function stubContext() {
	return {
		save: vi.fn(),
		restore: vi.fn(),
		beginPath: vi.fn(),
		arc: vi.fn(),
		fill: vi.fn(),
		stroke: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		fillText: vi.fn(),
		createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
		globalAlpha: 1,
		globalCompositeOperation: 'source-over',
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 1,
		lineCap: 'butt',
		font: '',
		textAlign: 'start',
		textBaseline: 'alphabetic',
	}
}

/** An animator a quarter of the way into absorbing a bubble of radius 40. */
function absorbing(): AbsorptionAnimator {
	const sut = new AbsorptionAnimator()
	sut.startAbsorption('a1', 'Ado', 100, 100, 200, 500, 40, 120)
	sut.update(100)
	return sut
}

describe('AbsorptionAnimator name drawing', () => {
	it('pastes the bubble’s own label through drawLabel when one is ready', () => {
		const sut = absorbing()
		const drawLabel = vi.fn(() => true)
		sut.drawLabel = drawLabel
		const ctx = stubContext()

		sut.render(ctx as unknown as CanvasRenderingContext2D)

		expect(drawLabel).toHaveBeenCalledOnce()
		const [name, , , radius, scale] = drawLabel.mock.calls[0] as unknown as [
			string,
			number,
			number,
			number,
			number,
		]
		expect(name).toBe('Ado')
		expect(radius).toBe(40)
		expect(scale).toBeLessThan(1)
		expect(ctx.fillText).not.toHaveBeenCalled()
	})

	it('draws the name as text when no label is ready', () => {
		const sut = absorbing()
		sut.drawLabel = vi.fn(() => false)
		const ctx = stubContext()

		sut.render(ctx as unknown as CanvasRenderingContext2D)

		expect(ctx.fillText).toHaveBeenCalledWith(
			'Ado',
			expect.any(Number),
			expect.any(Number),
			expect.any(Number),
		)
	})

	it('draws the name as text when no drawLabel is set', () => {
		const sut = absorbing()
		const ctx = stubContext()

		sut.render(ctx as unknown as CanvasRenderingContext2D)

		expect(ctx.fillText).toHaveBeenCalledOnce()
	})
})
