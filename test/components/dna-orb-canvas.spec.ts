import { INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artist } from '../../src/entities/artist'
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
			setPosition: vi.fn(),
		},
	},
}))

// Import after mocking
const { DnaOrbCanvas } = await import(
	'../../src/components/dna-orb/dna-orb-canvas'
)

function makeArtist(id: string, name: string): Artist {
	return { id, name, mbid: '' }
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
			expect(sut.artists).toEqual([])
		})
	})

	describe('artistsChanged', () => {
		it('should not add bubbles if not yet attached (no ctx)', () => {
			// ctx is not set until attached() is called
			const addBubblesSpy = vi.spyOn((sut as any).physics, 'addBubbles')
			sut.artistsChanged([makeArtist('a1', 'Artist')])

			expect(addBubblesSpy).not.toHaveBeenCalled()
		})

		it('should add bubbles to physics when ctx is available', async () => {
			// Simulate attached
			await sut.attached()
			const addBubblesSpy = vi.spyOn((sut as any).physics, 'addBubbles')

			const artists = [makeArtist('a1', 'Artist')]
			sut.artistsChanged(artists)

			expect(addBubblesSpy).toHaveBeenCalledWith([
				expect.objectContaining({
					artist: artists[0],
					radius: expect.any(Number),
				}),
			])
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
				'pointerdown',
				expect.any(Function),
			)
			expect(mockCanvas.addEventListener).toHaveBeenCalledWith(
				'keydown',
				expect.any(Function),
			)
		})

		it('should add initial artists to physics', async () => {
			const addBubblesSpy = vi.spyOn((sut as any).physics, 'addBubbles')
			sut.artists = [makeArtist('a1', 'Initial')]

			await sut.attached()

			expect(addBubblesSpy).toHaveBeenCalledWith([
				expect.objectContaining({
					artist: sut.artists[0],
					radius: expect.any(Number),
				}),
			])
		})
	})

	describe('detaching', () => {
		it('should remove event listeners and destroy physics', async () => {
			await sut.attached()
			const destroySpy = vi.spyOn((sut as any).physics, 'destroy')

			sut.detaching()

			expect(mockCanvas.removeEventListener).toHaveBeenCalledWith(
				'pointerdown',
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

	describe('artistsChanged — reconcile placements', () => {
		it('forwards the bound placement hints to physics.reconcile', async () => {
			await sut.attached()
			const reconcileSpy = vi.spyOn((sut as any).physics, 'reconcile')

			const placements = new Map([['b', { x: 12, y: 34 }]])
			sut.placements = placements
			sut.artistsChanged([makeArtist('a', 'A'), makeArtist('b', 'B')])

			expect(reconcileSpy).toHaveBeenCalledWith(expect.any(Array), {
				placements,
			})
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

			const artist = makeArtist('a1', 'Tapped Artist')
			const mockPhysicsBubble = {
				body: { position: { x: 150, y: 250 } },
				artist,
				radius: 30,
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

			const artist = makeArtist('a1', 'Absorbed')
			const mockBubble = {
				body: { position: { x: 100, y: 200 } },
				artist,
				radius: 30,
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

			// The bubble is removed immediately; absorption begins after the brief
			// squash-and-stretch press pre-roll, flushed here by advancing the
			// tap-effects clock past its lifetime.
			expect(removeSpy).toHaveBeenCalledWith('a1')
			;(sut as any).tapEffects.update(100)
			expect(absorptionSpy).toHaveBeenCalledWith(
				'a1',
				'Absorbed',
				100,
				200,
				expect.any(Number), // orbX
				expect.any(Number), // orbY
				30, // radius
				expect.any(Number), // hue
				expect.any(Function), // onComplete
			)
		})

		it('should prevent concurrent interactions (isProcessing guard)', async () => {
			await sut.attached()

			const artist = makeArtist('a1', 'Guard')
			const mockBubble = {
				body: { position: { x: 100, y: 200 } },
				artist,
				radius: 30,
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

	describe('onAbsorbComplete (gesture-driven activation)', () => {
		it('advances the orb one stage, celebrates, and plays the tone on each follow', async () => {
			await sut.attached()
			const applySpy = vi.spyOn((sut as any).orbRenderer, 'applyLevel')
			const celebrateSpy = vi.spyOn((sut as any).orbRenderer, 'celebrate')
			const landingSpy = vi.spyOn((sut as any).audio, 'playLanding')

			;(sut as any).onAbsorbComplete(200)

			// First genuine follow this session grows the orb to stage 1 and celebrates.
			expect(applySpy).toHaveBeenCalledWith(1)
			expect(celebrateSpy).toHaveBeenCalledTimes(1)
			expect(celebrateSpy).toHaveBeenCalledWith(200)
			expect(landingSpy).toHaveBeenCalledWith(200)

			;(sut as any).onAbsorbComplete(120)

			// Second follow advances to stage 2 — gradual, session-scoped growth.
			expect(applySpy).toHaveBeenCalledWith(2)
			expect(celebrateSpy).toHaveBeenCalledTimes(2)
		})
	})

	describe('attached() enters dormant', () => {
		it('seeds the orb dormant (stage 0) regardless of the total follow count, with no celebration', async () => {
			// A returning user already following N artists must still enter Discovery
			// with a dormant orb — the orb activates only via a genuine follow gesture,
			// never from the bound total count on entry.
			sut.followedCount = 5
			const applySpy = vi.spyOn((sut as any).orbRenderer, 'applyLevel')
			const celebrateSpy = vi.spyOn((sut as any).orbRenderer, 'celebrate')

			await sut.attached()

			expect(applySpy).toHaveBeenCalledWith(0)
			expect(applySpy).not.toHaveBeenCalledWith(5)
			expect(celebrateSpy).not.toHaveBeenCalled()
		})
	})

	describe('attached() 0×0 layout deferral (regression #526/#527)', () => {
		it('settles attached() when detached while still waiting for a non-zero size', async () => {
			// Element is 0×0 at attach → attached() awaits a ResizeObserver that never
			// fires here. detaching() must resolve that wait so attached() does not
			// hang forever (leaking the component).
			;(
				mockElement.getBoundingClientRect as ReturnType<typeof vi.fn>
			).mockReturnValue({ width: 0, height: 0, top: 0, left: 0 })
			class MockResizeObserver {
				observe(): void {}
				disconnect(): void {}
				unobserve(): void {}
			}
			vi.stubGlobal('ResizeObserver', MockResizeObserver)
			try {
				const addSpy = vi.spyOn((sut as any).physics, 'addBubbles')
				const attachedPromise = sut.attached()
				sut.detaching()
				await expect(attachedPromise).resolves.toBeUndefined()
				// Bailed via the detached guard — never painted into an uninitialized layer.
				expect(addSpy).not.toHaveBeenCalled()
			} finally {
				vi.unstubAllGlobals()
			}
		})
	})
})
