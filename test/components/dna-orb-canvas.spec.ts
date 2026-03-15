import { INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtistBubble } from '../../src/services/artist-service-client'
import { createTestContainer } from '../helpers/create-container'

// Mock Matter.js to avoid loading the actual physics engine
vi.mock('matter-js', () => ({
	default: {
		Engine: {
			create: vi.fn(() => ({ world: {} })),
			update: vi.fn(),
			clear: vi.fn(),
		},
		Composite: {
			add: vi.fn(),
			remove: vi.fn(),
			clear: vi.fn(),
		},
		Bodies: {
			circle: vi.fn(() => ({
				position: { x: 100, y: 100 },
			})),
			rectangle: vi.fn(() => ({
				position: { x: 0, y: 0 },
			})),
		},
		Body: {
			applyForce: vi.fn(),
		},
	},
}))

// Import after mocking
const { DnaOrbCanvas } = await import(
	'../../src/components/dna-orb/dna-orb-canvas'
)

function makeBubble(id: string, name: string): ArtistBubble {
	return { id, name, mbid: '', imageUrl: '', x: 0, y: 0, radius: 30 }
}

function createMockCanvasContext(): CanvasRenderingContext2D {
	return {
		clearRect: vi.fn(),
		save: vi.fn(),
		restore: vi.fn(),
		beginPath: vi.fn(),
		arc: vi.fn(),
		fill: vi.fn(),
		stroke: vi.fn(),
		clip: vi.fn(),
		fillText: vi.fn(),
		drawImage: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		setTransform: vi.fn(),
		setLineDash: vi.fn(),
		createRadialGradient: vi.fn(() => ({
			addColorStop: vi.fn(),
		})),
		globalAlpha: 1,
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 1,
		font: '',
		textAlign: 'center',
		textBaseline: 'middle',
	} as unknown as CanvasRenderingContext2D
}

describe('DnaOrbCanvas', () => {
	let sut: InstanceType<typeof DnaOrbCanvas>
	let mockElement: HTMLElement
	let mockCanvas: HTMLCanvasElement
	let mockCtx: CanvasRenderingContext2D
	let dispatchedEvents: CustomEvent[]

	beforeEach(() => {
		vi.useFakeTimers()
		dispatchedEvents = []
		mockCtx = createMockCanvasContext()

		mockCanvas = {
			getContext: vi.fn(() => mockCtx),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			getBoundingClientRect: vi.fn(() => ({
				width: 400,
				height: 600,
				top: 0,
				left: 0,
			})),
			width: 400,
			height: 600,
			style: { width: '400px', height: '600px' },
		} as unknown as HTMLCanvasElement

		mockElement = {
			getBoundingClientRect: vi.fn(() => ({
				width: 400,
				height: 600,
				top: 0,
				left: 0,
			})),
			dispatchEvent: vi.fn((event: CustomEvent) => {
				dispatchedEvents.push(event)
				return true
			}),
		} as unknown as HTMLElement

		const container = createTestContainer(
			Registration.instance(INode, mockElement),
		)
		container.register(DnaOrbCanvas)
		sut = container.get(DnaOrbCanvas)

		// Wire up the canvas ref (normally Aurelia template binding does this)
		;(sut as any).canvas = mockCanvas
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('bindable defaults', () => {
		it('should initialize with default bindable values', () => {
			expect(sut.followedCount).toBe(0)
			expect(sut.showFollowedIndicator).toBe(false)
			expect(sut.artists).toEqual([])
			expect(sut.followedIds).toEqual(new Set())
		})
	})

	describe('artistsChanged', () => {
		it('should not add bubbles if not yet attached (no ctx)', () => {
			// ctx is not set until attached() is called
			const addBubblesSpy = vi.spyOn((sut as any).physics, 'addBubbles')
			sut.artistsChanged([makeBubble('a1', 'Artist')])

			expect(addBubblesSpy).not.toHaveBeenCalled()
		})

		it('should add bubbles to physics when ctx is available', async () => {
			// Simulate attached
			await sut.attached()
			const addBubblesSpy = vi.spyOn((sut as any).physics, 'addBubbles')

			const artists = [makeBubble('a1', 'Artist')]
			sut.artistsChanged(artists)

			expect(addBubblesSpy).toHaveBeenCalledWith(artists)
		})
	})

	describe('attached', () => {
		it('should get 2D context from canvas', async () => {
			await sut.attached()

			expect(mockCanvas.getContext).toHaveBeenCalledWith('2d')
		})

		it('should register event listeners on canvas', async () => {
			await sut.attached()

			expect(mockCanvas.addEventListener).toHaveBeenCalledWith(
				'click',
				expect.any(Function),
			)
			expect(mockCanvas.addEventListener).toHaveBeenCalledWith(
				'touchstart',
				expect.any(Function),
				{ passive: true },
			)
			expect(mockCanvas.addEventListener).toHaveBeenCalledWith(
				'keydown',
				expect.any(Function),
			)
		})

		it('should add initial artists to physics', async () => {
			const addBubblesSpy = vi.spyOn((sut as any).physics, 'addBubbles')
			sut.artists = [makeBubble('a1', 'Initial')]

			await sut.attached()

			expect(addBubblesSpy).toHaveBeenCalledWith(sut.artists)
		})
	})

	describe('detaching', () => {
		it('should remove event listeners and destroy physics', async () => {
			await sut.attached()
			const destroySpy = vi.spyOn((sut as any).physics, 'destroy')

			sut.detaching()

			expect(mockCanvas.removeEventListener).toHaveBeenCalledWith(
				'click',
				expect.any(Function),
			)
			expect(destroySpy).toHaveBeenCalled()
		})
	})

	describe('pause / resume', () => {
		it('should set paused state and cancel animation frame', async () => {
			await sut.attached()
			const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame')

			sut.pause()

			expect(cancelSpy).toHaveBeenCalled()
		})

		it('should be idempotent when already paused', async () => {
			await sut.attached()
			sut.pause()

			const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame')
			sut.pause() // second call

			expect(cancelSpy).not.toHaveBeenCalled()
		})

		it('should restart animation loop on resume', async () => {
			await sut.attached()
			sut.pause()

			const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
			sut.resume()

			expect(rafSpy).toHaveBeenCalled()
		})

		it('should be idempotent when not paused', async () => {
			await sut.attached()

			const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
			const callsBefore = rafSpy.mock.calls.length
			sut.resume()

			// resume should not add additional requestAnimationFrame calls
			expect(rafSpy.mock.calls.length).toBe(callsBefore)
		})
	})

	describe('spawnBubblesAt', () => {
		it('should delegate to physics.spawnBubblesAt', async () => {
			await sut.attached()
			const spawnSpy = vi.spyOn((sut as any).physics, 'spawnBubblesAt')
			const bubbles = [makeBubble('s1', 'Spawn')]

			sut.spawnBubblesAt(bubbles, 100, 200)

			expect(spawnSpy).toHaveBeenCalledWith(bubbles, 100, 200)
		})
	})

	describe('fadeOutBubbles', () => {
		it('should delegate to physics.fadeOutBubbles', async () => {
			await sut.attached()
			const fadeOutSpy = vi
				.spyOn((sut as any).physics, 'fadeOutBubbles')
				.mockResolvedValue(undefined)

			await sut.fadeOutBubbles(['a1', 'a2'])

			expect(fadeOutSpy).toHaveBeenCalledWith(['a1', 'a2'])
		})
	})

	describe('reloadBubbles', () => {
		it('should reset physics and add new artists', async () => {
			await sut.attached()
			const resetSpy = vi.spyOn((sut as any).physics, 'reset')
			const initSpy = vi
				.spyOn((sut as any).physics, 'init')
				.mockResolvedValue(undefined)
			const addSpy = vi.spyOn((sut as any).physics, 'addBubbles')

			const newArtists = [makeBubble('r1', 'Reloaded')]
			sut.reloadBubbles(newArtists)

			expect(resetSpy).toHaveBeenCalled()

			// Wait for init promise
			await vi.advanceTimersByTimeAsync(0)

			expect(initSpy).toHaveBeenCalledWith(400, 600)
			expect(addSpy).toHaveBeenCalledWith(newArtists)
		})

		it('should skip if element has zero dimensions', async () => {
			await sut.attached()
			;(
				mockElement.getBoundingClientRect as ReturnType<typeof vi.fn>
			).mockReturnValue({
				width: 0,
				height: 0,
			})

			const resetSpy = vi.spyOn((sut as any).physics, 'reset')
			sut.reloadBubbles([makeBubble('r1', 'Skip')])

			expect(resetSpy).not.toHaveBeenCalled()
		})
	})

	describe('bubbleCount', () => {
		it('should delegate to physics.bubbleCount', () => {
			vi.spyOn((sut as any).physics, 'bubbleCount', 'get').mockReturnValue(42)
			expect(sut.bubbleCount).toBe(42)
		})
	})

	describe('handleInteraction (DOM event dispatch)', () => {
		it('should dispatch artist-selected and need-more-bubbles events on bubble tap', async () => {
			await sut.attached()

			const artist = makeBubble('a1', 'Tapped Artist')
			const mockPhysicsBubble = {
				body: { position: { x: 150, y: 250 } },
				artist,
				scale: 1,
				opacity: 1,
				isSpawning: false,
				spawnProgress: 1,
				isFadingOut: false,
				fadeOutProgress: 0,
			}

			vi.spyOn((sut as any).physics, 'getBubbleAt').mockReturnValue(
				mockPhysicsBubble,
			)
			vi.spyOn((sut as any).physics, 'removeBubble').mockReturnValue(
				mockPhysicsBubble,
			)
			vi.spyOn((sut as any).absorptionAnimator, 'startAbsorption')

			// Call handleInteraction directly
			;(sut as any).handleInteraction(150, 250)

			expect(dispatchedEvents).toHaveLength(2)

			// First event: artist-selected
			expect(dispatchedEvents[0].type).toBe('artist-selected')
			expect(dispatchedEvents[0].detail.artist).toBe(artist)
			expect(dispatchedEvents[0].detail.position).toEqual({ x: 150, y: 250 })

			// Second event: need-more-bubbles
			expect(dispatchedEvents[1].type).toBe('need-more-bubbles')
			expect(dispatchedEvents[1].detail.artistId).toBe('a1')
			expect(dispatchedEvents[1].detail.artistName).toBe('Tapped Artist')
			expect(dispatchedEvents[1].detail.position).toEqual({ x: 150, y: 250 })
		})

		it('should not dispatch events when no bubble at tap position', async () => {
			await sut.attached()

			vi.spyOn((sut as any).physics, 'getBubbleAt').mockReturnValue(undefined)

			;(sut as any).handleInteraction(999, 999)

			expect(dispatchedEvents).toHaveLength(0)
		})

		it('should remove tapped bubble from physics and start absorption', async () => {
			await sut.attached()

			const artist = makeBubble('a1', 'Absorbed')
			const mockBubble = {
				body: { position: { x: 100, y: 200 } },
				artist,
				scale: 1,
				opacity: 1,
				isSpawning: false,
				spawnProgress: 1,
				isFadingOut: false,
				fadeOutProgress: 0,
			}

			vi.spyOn((sut as any).physics, 'getBubbleAt').mockReturnValue(mockBubble)
			const removeSpy = vi
				.spyOn((sut as any).physics, 'removeBubble')
				.mockReturnValue(mockBubble)
			const absorptionSpy = vi.spyOn(
				(sut as any).absorptionAnimator,
				'startAbsorption',
			)

			;(sut as any).handleInteraction(100, 200)

			expect(removeSpy).toHaveBeenCalledWith('a1')
			expect(absorptionSpy).toHaveBeenCalledWith(
				'a1',
				'Absorbed',
				100,
				200,
				expect.any(Number), // orbX
				expect.any(Number), // orbY
				30, // radius
				'', // imageUrl
				expect.any(Number), // hue
				expect.any(Function), // onComplete
			)
		})

		it('should prevent concurrent interactions (isProcessing guard)', async () => {
			await sut.attached()

			const artist = makeBubble('a1', 'Guard')
			const mockBubble = {
				body: { position: { x: 100, y: 200 } },
				artist,
				scale: 1,
				opacity: 1,
				isSpawning: false,
				spawnProgress: 1,
				isFadingOut: false,
				fadeOutProgress: 0,
			}

			let callCount = 0
			vi.spyOn((sut as any).physics, 'getBubbleAt').mockImplementation(() => {
				callCount++
				if (callCount === 1) {
					// Simulate a concurrent call during processing
					;(sut as any).handleInteraction(100, 200)
				}
				return mockBubble
			})
			vi.spyOn((sut as any).physics, 'removeBubble').mockReturnValue(mockBubble)
			vi.spyOn((sut as any).absorptionAnimator, 'startAbsorption')

			;(sut as any).handleInteraction(100, 200)

			// getBubbleAt should only be called once (second call blocked by isProcessing)
			expect(callCount).toBe(1)
		})
	})

	describe('followedCountChanged', () => {
		it('should pulse the orb renderer', () => {
			const pulseSpy = vi.spyOn((sut as any).orbRenderer, 'pulse')
			sut.followedCountChanged(5, 4)
			expect(pulseSpy).toHaveBeenCalled()
		})
	})
})
