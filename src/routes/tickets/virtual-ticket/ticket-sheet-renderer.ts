// The page's Content-Security-Policy has no 'unsafe-eval' (index.html), and
// PixiJS builds its uniform and shader sync code with `new Function`. This
// module, which must come before any other PixiJS import, swaps in versions
// that need no eval; without it every renderer throws at start in the app.
import 'pixi.js/unsafe-eval'
import {
	Application,
	Container,
	type Filter,
	Graphics,
	MeshPlane,
	Rectangle,
	Texture,
} from 'pixi.js'
import { HTMLSource } from 'pixi.js/html-source'
import { RGBSplitFilter } from 'pixi-filters/rgb-split'
import { ShockwaveFilter } from 'pixi-filters/shockwave'
import type { TicketLook } from './ticket-presets'
import {
	applyLook,
	createHoloFilter,
	type HoloUniforms,
	holoUniformsOf,
} from './ticket-renderer'

/**
 * Draws a whole virtual ticket, text included, as a sheet of paper in WebGL
 * with HTML-in-Canvas: both sides stay live DOM (selectable, read aloud),
 * and the browser hands their pixels to PixiJS as textures. Because the
 * text is in the texture, the sheet can bend while it turns over, and the
 * foil and the stamp's shockwave run through the lettering too.
 *
 * Needs Chrome 157 or later; see `sheetSupported`.
 */

/** The canvas of a browser with HTML-in-Canvas. */
interface SheetCanvas extends HTMLCanvasElement {
	requestPaint?: () => void
	updateElementGeometry?: (
		element: Element,
		options: { canvasTransform: DOMMatrix },
	) => void
}

export interface TicketSheetOptions {
	/** The canvas the two sides are descendants of. */
	readonly canvas: HTMLCanvasElement
	readonly front: HTMLElement
	readonly back: HTMLElement
	/** The ticket's size in CSS pixels. */
	readonly width: number
	readonly height: number
	/** The room around the ticket on the canvas, for the bend and the sparks. */
	readonly margin: number
	readonly look: TicketLook
	/** The art's share of the front's height. */
	readonly split: number
	/** Device pixels per CSS pixel of the drawing. */
	readonly resolution: number
}

/** Whether this browser can draw DOM into a WebGL texture. */
export function sheetSupported(): boolean {
	return (
		typeof HTMLCanvasElement !== 'undefined' &&
		'requestPaint' in HTMLCanvasElement.prototype &&
		typeof WebGL2RenderingContext !== 'undefined' &&
		'texElementSubImage2D' in WebGL2RenderingContext.prototype
	)
}

/**
 * An `HTMLSource` taken at its resolution. PixiJS's (8.22.0-dev.f7d8c62)
 * reads the element's CSS size as its size in pixels (`resourceWidth` is
 * `offsetWidth`), so whatever the resolution, a side is taken at 1 pixel per
 * CSS pixel and stretched to the screen: on a phone the text blurs. The
 * browser draws the element at the size it is asked for.
 */
class SharpHTMLSource extends HTMLSource {
	override get resourceWidth(): number {
		return Math.round(super.resourceWidth * this._resolution)
	}

	override get resourceHeight(): number {
		return Math.round(super.resourceHeight * this._resolution)
	}
}

const COLUMNS = 22
const ROWS = 30
/** How long turning the ticket over takes, in seconds. */
const TURN_SECONDS = 0.55
/** The distance of the eye from the sheet, in CSS pixels. */
const EYE = 900
const IMPACT_SECONDS = 1.4
/** The shockwave's height and the colour split at the moment of impact, in pixels. */
const SHOCK_AMPLITUDE = 12
const SPLIT_KICK = 4
const PARTICLES = 44
const IDLE_AFTER = 1.6
/**
 * The foil over the whole sheet, text included: lighter than over the art
 * alone, and faint on the back, so the lettering stays easy to read.
 */
const FRONT_FOIL = 0.35
const BACK_FOIL = 0.1

/**
 * The look of the sheet's own pass over the whole ticket. The front's art is
 * drawn by its own renderer inside the front, graded, foiled and with its
 * glitter, grain and scan lines (ticket-renderer.ts), and the sheet takes it
 * in with the rest of the front. So the sheet only lays a light foil and the
 * glare over everything, text included; doing the art's grading again would
 * grade it twice.
 */
function sheetLook(look: TicketLook): TicketLook {
	return { ...look, grade: 0, sparkle: 0, scan: 0, grain: 0 }
}

interface Particle {
	readonly node: Graphics
	vx: number
	vy: number
	life: number
}

export class TicketSheetRenderer {
	private readonly world = new Container()
	private readonly sparks = new Container()
	private readonly mesh: MeshPlane
	private readonly frontSource: HTMLSource
	private readonly backSource: HTMLSource
	private readonly frontTexture: Texture
	private readonly backTexture: Texture
	private readonly holo: Filter
	private readonly uniforms: HoloUniforms
	private shock: ShockwaveFilter | null = null
	private split: RGBSplitFilter | null = null
	private impactAge = -1
	private particles: Particle[] = []

	/** 0 shows the front, 1 the back; `turn` eases towards `turnTo`. */
	private turn = 0
	private turnTo = 0
	private tiltX = 0
	private tiltY = 0
	private targetX = 0
	private targetY = 0
	private sinceInput = IDLE_AFTER
	private seconds = 0
	private thump = 0
	/** The foil's strength on the side that faces the fan, and the stamp's boost. */
	private faceFoil = FRONT_FOIL
	private boost = 0
	/** The browser has painted the sides at least once. */
	private painted = false
	private destroyed = false

	private constructor(
		private readonly app: Application,
		private readonly options: TicketSheetOptions,
	) {
		// The sources do not follow the browser's paints by themselves: their
		// own listener uploads inside the `paint` event, and a side without a
		// paint record yet (a frame or two after the card moves into the
		// canvas) makes that throw where nothing can catch it. `onPaint` below
		// does the same with the failure handled.
		// Taken at the resolution the sheet is drawn at: a side taken at its
		// CSS size is stretched to the screen, and its text blurs.
		this.frontSource = new SharpHTMLSource({
			resource: options.front,
			autoUpdate: false,
			resolution: options.resolution,
		})
		this.backSource = new SharpHTMLSource({
			resource: options.back,
			autoUpdate: false,
			resolution: options.resolution,
		})
		options.canvas.addEventListener('paint', this.onPaint)
		;(options.canvas as SheetCanvas).requestPaint?.()
		this.frontTexture = new Texture({
			source: this.frontSource,
		})
		this.backTexture = new Texture({
			source: this.backSource,
		})
		this.mesh = new MeshPlane({
			texture: this.frontTexture,
			verticesX: COLUMNS,
			verticesY: ROWS,
		})
		this.mesh.autoResize = false

		this.holo = createHoloFilter(sheetLook(options.look), options.split)
		this.uniforms = holoUniformsOf(this.holo)
		this.sparks.blendMode = 'add'
		this.world.addChild(this.mesh, this.sparks)
		this.world.filters = [this.holo]
		// The filters cover the whole canvas, so the bent sheet and the
		// sparks are never clipped.
		this.world.filterArea = new Rectangle(
			0,
			0,
			options.width + options.margin * 2,
			options.height + options.margin * 2,
		)
		app.stage.addChild(this.world)
		// The sheet draws its own frames: a side the browser has not painted
		// yet makes the upload throw, and the application's own render call
		// would let that escape as an unhandled error.
		app.ticker.remove(app.render, app)
		app.ticker.add((ticker) => {
			this.tick(ticker.deltaMS / 1000)
			this.draw()
		})
		this.place()
	}

	public static async create(
		options: TicketSheetOptions,
	): Promise<TicketSheetRenderer> {
		const app = new Application()
		await app.init({
			canvas: options.canvas,
			width: options.width + options.margin * 2,
			height: options.height + options.margin * 2,
			backgroundAlpha: 0,
			antialias: true,
			autoDensity: true,
			resolution: options.resolution,
			preference: 'webgl',
		})
		return new TicketSheetRenderer(app, options)
	}

	public setLook(look: TicketLook): void {
		if (!this.destroyed) applyLook(this.uniforms, sheetLook(look))
	}

	public tiltTo(x: number, y: number): void {
		this.targetX = clamp(x)
		this.targetY = clamp(y)
		this.sinceInput = 0
	}

	public release(): void {
		this.sinceInput = IDLE_AFTER
	}

	/** Turn the sheet to show its back (true) or its front (false). */
	public showBack(back: boolean): void {
		this.turnTo = back ? 1 : 0
	}

	/** The stamp has landed at this point of the front (0-1 on each axis). */
	public impact(x: number, y: number): void {
		if (this.destroyed) return
		const { margin, width, height } = this.options
		const cx = margin + x * width
		const cy = margin + y * height
		this.shock = new ShockwaveFilter({
			center: { x: cx, y: cy },
			speed: Math.max(width, height) * 0.8,
			amplitude: SHOCK_AMPLITUDE,
			wavelength: width * 0.9,
			brightness: 1.1,
			radius: -1,
			time: 0,
		})
		this.shock.resolution = 'inherit'

		this.split = new RGBSplitFilter({
			red: { x: -SPLIT_KICK, y: 0 },
			green: { x: 0, y: 0 },
			blue: { x: SPLIT_KICK, y: 0 },
		})
		this.split.resolution = 'inherit'

		this.world.filters = [this.holo, this.shock, this.split]
		this.impactAge = 0
		this.thump = 1

		for (const p of this.particles) p.node.destroy()
		this.particles = []
		for (let i = 0; i < PARTICLES; i++) {
			const angle = (i / PARTICLES) * Math.PI * 2 + Math.random() * 0.4
			const speed = width * (0.5 + Math.random() * 1.1)
			const node = new Graphics()
				.star(0, 0, 4, 2 + Math.random() * 3.5, 0.8)
				.fill(i % 3 === 0 ? 0xffffff : 0xffd36b)
			node.position.set(cx, cy)
			this.sparks.addChild(node)
			this.particles.push({
				node,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed - width * 0.25,
				life: 0.6 + Math.random() * 0.5,
			})
		}
	}

	public destroy(): void {
		if (this.destroyed) return
		this.destroyed = true
		this.options.canvas.removeEventListener('paint', this.onPaint)
		this.app.destroy({ removeView: false }, { children: true, texture: true })
	}

	/** The browser painted the sides: take the new pixels. */
	private readonly onPaint = (): void => {
		if (this.destroyed) return
		try {
			this.frontSource.update()
			this.backSource.update()
			this.painted = true
		} catch {
			this.askForPaint()
		}
	}

	private askForPaint(): void {
		;(this.options.canvas as SheetCanvas).requestPaint?.()
	}

	/**
	 * Draw a frame. The browser keeps a paint record per side, and uploading
	 * a side that has none yet throws ("No cached paint record for
	 * element"). Such a frame is skipped and a paint is asked for.
	 */
	private draw(): void {
		if (this.destroyed) return
		if (!this.painted) {
			this.askForPaint()
			return
		}
		try {
			this.app.render()
		} catch {
			this.askForPaint()
		}
	}

	private tick(dt: number): void {
		if (this.destroyed) return
		this.seconds += dt
		this.sinceInput += dt
		if (this.sinceInput >= IDLE_AFTER) {
			this.targetX = Math.sin(this.seconds * 0.7) * 0.55
			this.targetY = Math.cos(this.seconds * 0.5) * 0.4
		}
		const ease = 1 - Math.exp(-dt * 7)
		this.tiltX += (this.targetX - this.tiltX) * ease
		this.tiltY += (this.targetY - this.tiltY) * ease

		const step = dt / TURN_SECONDS
		if (this.turn < this.turnTo)
			this.turn = Math.min(this.turnTo, this.turn + step)
		if (this.turn > this.turnTo)
			this.turn = Math.max(this.turnTo, this.turn - step)
		this.thump *= Math.exp(-dt * 7)

		this.uniforms.uTilt[0] = this.tiltX
		this.uniforms.uTilt[1] = this.tiltY
		this.uniforms.uTime = this.seconds
		this.place()
		this.stepImpact(dt)
		this.uniforms.uStrength = this.faceFoil * (1 + this.boost)
	}

	/**
	 * Move the sheet's vertices: turned about its vertical axis by `turn`,
	 * tilted towards the pointer, and bent like paper while it turns (its
	 * top runs ahead of its foot, and it bows across its width).
	 */
	private place(): void {
		const { width, height, margin, front, back, canvas } = this.options
		// Eased, so the turn starts and lands softly.
		const eased = this.turn * this.turn * (3 - 2 * this.turn)
		const curl = Math.sin(eased * Math.PI)
		const showsBack = eased > 0.5
		const base = (showsBack ? eased - 1 : eased) * Math.PI

		this.mesh.texture = showsBack ? this.backTexture : this.frontTexture
		this.faceFoil = showsBack ? BACK_FOIL : FRONT_FOIL
		// The back has no art: the foil stays faint all over it.
		// The art's foot as a share of the canvas, which the foil is laid over.
		this.uniforms.uSplit = showsBack
			? 0
			: (margin + height * this.options.split) / (height + margin * 2)

		const tiltY = this.tiltX * 0.16
		const tiltX = this.tiltY * -0.12
		const cosX = Math.cos(tiltX)
		const sinX = Math.sin(tiltX)
		const scale = 1 - this.thump * 0.025
		const cx = margin + width / 2
		const cy = margin + height / 2

		const buffer = this.mesh.geometry.getBuffer('aPosition')
		const positions = buffer.data as Float32Array
		for (let row = 0; row < ROWS; row++) {
			const v = row / (ROWS - 1)
			// The top of the sheet turns ahead of its foot.
			const angle = base + tiltY + curl * 0.55 * (0.5 - v)
			const cos = Math.cos(angle)
			const sin = Math.sin(angle)
			for (let column = 0; column < COLUMNS; column++) {
				const u = column / (COLUMNS - 1)
				const x = (u - 0.5) * width * scale
				const y = (v - 0.5) * height * scale
				// It bows across its width while it turns.
				const bow = curl * 34 * (1 - (2 * u - 1) ** 2)
				const xr = x * cos + bow * sin
				const zr = -x * sin + bow * cos
				const yr = y * cosX - zr * sinX
				const depth = y * sinX + zr * cosX
				const near = EYE / (EYE - depth)
				const i = (row * COLUMNS + column) * 2
				positions[i] = cx + xr * near
				positions[i + 1] = cy + yr * near
			}
		}
		buffer.update()

		// Darker as it turns away from the light.
		const lit = Math.round((0.5 + 0.5 * Math.abs(Math.cos(base))) * 255)
		this.mesh.tint = (lit << 16) | (lit << 8) | lit

		// Tell the browser where the side that faces the fan was drawn, so
		// pointing at it and selecting its text hit the right place.
		const facing = showsBack ? back : front
		const at = new DOMMatrix([1, 0, 0, 1, margin, margin])
		;(canvas as SheetCanvas).updateElementGeometry?.(facing, {
			canvasTransform: at,
		})
	}

	private stepImpact(dt: number): void {
		if (this.impactAge < 0) return
		this.impactAge += dt
		const t = this.impactAge / IMPACT_SECONDS
		// Everything dies away along one curve, fast at first, so nothing
		// stops with a jolt.
		const fade = (1 - Math.min(1, t)) ** 2
		if (this.shock) {
			this.shock.time = this.impactAge
			this.shock.amplitude = SHOCK_AMPLITUDE * fade
		}
		if (this.split) {
			const kick = SPLIT_KICK * fade ** 2
			this.split.red = { x: -kick, y: 0 }
			this.split.blue = { x: kick, y: 0 }
		}
		this.boost = fade * 0.6

		const gravity = this.options.width * 1.6
		for (const p of this.particles) {
			p.life -= dt
			p.vy += gravity * dt
			p.node.x += p.vx * dt
			p.node.y += p.vy * dt
			p.node.rotation += dt * 6
			p.node.alpha = Math.max(0, Math.min(1, p.life * 2.5))
		}

		if (t >= 1) {
			this.impactAge = -1
			this.world.filters = [this.holo]
			this.shock = null
			this.split = null
			this.boost = 0
			for (const p of this.particles) p.node.destroy()
			this.particles = []
		}
	}
}

function clamp(v: number): number {
	return Math.max(-1, Math.min(1, v))
}
