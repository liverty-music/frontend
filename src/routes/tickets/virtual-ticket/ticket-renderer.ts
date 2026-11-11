import {
	Application,
	BlurFilter,
	Container,
	FillGradient,
	Filter,
	GlProgram,
	Graphics,
	Rectangle,
	Sprite,
	Texture,
} from 'pixi.js'
import { RGBSplitFilter } from 'pixi-filters/rgb-split'
import { ShockwaveFilter } from 'pixi-filters/shockwave'
import type { TicketLook } from './ticket-presets'

/**
 * Draws the front of a virtual ticket with WebGL, under the DOM text that
 * sits on it: the cover image with parallax, a holographic foil and a glare
 * that follow the ticket's tilt, and the burst when the admission stamp
 * lands. It draws no text; everything a fan reads stays in the DOM.
 *
 * This module pulls in PixiJS, so the component loads it lazily.
 */

export interface TicketRendererOptions {
	readonly canvas: HTMLCanvasElement
	/** The first performer's hue (0-359); colours the paper and a missing cover. */
	readonly hue: number
	/** The stub's paper colour, as 0xRRGGBB (the CSS paper colour, resolved). */
	readonly paper: number
	/** The preset's grading and foil. */
	readonly look: TicketLook
	/** The art's share of the ticket's height (0-1); the stub is the rest. */
	readonly split: number
	/** Draw one still frame per change instead of animating. */
	readonly still: boolean
	/** Device pixels per CSS pixel; the screen's, at most 2, when left out. */
	readonly resolution?: number
	/** Called every frame with the smoothed tilt, each axis in -1..1. */
	readonly onTilt?: (x: number, y: number) => void
}

const VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
	vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
	position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
	position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
	gl_Position = vec4(position, 0.0, 1.0);
	vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`

/**
 * Holographic foil: rainbow diffraction bands that slide as the ticket
 * tilts, cut by fine foil lines, with twinkling glitter on the art, a sheen
 * band and a soft glare. The foil is strong on the art and faint on the stub.
 */
const HOLO_FRAGMENT = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec2 uTilt;
uniform float uTime;
uniform float uSplit;
uniform float uStrength;
uniform vec3 uShadow;
uniform vec3 uLight;
uniform float uGrade;
uniform vec3 uFoilTint;
uniform float uRainbow;
uniform float uFoil;
uniform float uScan;
uniform float uGrain;
uniform float uSparkle;

vec3 rainbow(float h) {
	return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
		mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main(void) {
	vec4 base = texture(uTexture, vTextureCoord);
	vec2 uv = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
	float aspect = uOutputFrame.z / uOutputFrame.w;
	vec2 p = vec2(uv.x * aspect, uv.y);

	float onArt = 1.0 - smoothstep(uSplit - 0.004, uSplit + 0.004, uv.y);
	float lum = dot(base.rgb, vec3(0.299, 0.587, 0.114));

	// The preset's duotone, on the art only.
	vec3 duotone = mix(uShadow, uLight, smoothstep(0.04, 0.92, lum));
	base.rgb = mix(base.rgb, duotone, uGrade * onArt);
	lum = dot(base.rgb, vec3(0.299, 0.587, 0.114));

	float band = dot(p, vec2(0.85, 0.55)) * 2.4 + uTilt.x * 1.6 + uTilt.y * 1.1
		+ noise(p * 3.2) * 0.45 + uTime * 0.02;
	vec3 foil = mix(uFoilTint * (0.55 + 0.45 * sin(band * 6.2832)), rainbow(fract(band)), uRainbow);

	float lines = 0.5 + 0.5 * sin((p.x - p.y) * 620.0);
	vec2 centre = vec2(0.5 * aspect, 0.5);
	float along = dot(p - centre, normalize(vec2(1.0, 0.55)));
	float sweep = smoothstep(0.42, 0.0, abs(along - uTilt.x * 0.95 - uTilt.y * 0.45));

	float mask = (0.3 + 0.9 * sweep) * (0.78 + 0.22 * lines) * mix(0.2, 1.0, onArt);
	vec3 colour = base.rgb + foil * mask * uStrength * uFoil * (0.28 + 0.6 * lum);

	vec2 cell = floor(p * 46.0);
	float seed = hash(cell);
	float twinkle = pow(max(0.0, sin(seed * 60.0 + uTime * 1.8 + uTilt.x * 9.0 + uTilt.y * 7.0)), 28.0)
		* step(0.92, seed);
	vec2 inCell = fract(p * 46.0) - 0.5;
	float cross = max(
		smoothstep(0.5, 0.0, abs(inCell.x) * 9.0 + abs(inCell.y)),
		smoothstep(0.5, 0.0, abs(inCell.y) * 9.0 + abs(inCell.x)));
	float star = max(cross, smoothstep(0.16, 0.0, length(inCell)));
	colour += (foil * 0.6 + 0.6) * twinkle * star * onArt * uStrength * uSparkle * 1.3;

	vec2 glareAt = vec2((0.5 + uTilt.x * 0.55) * aspect, 0.32 - uTilt.y * 0.45);
	float glare = smoothstep(0.8, 0.0, distance(p, glareAt));
	colour += vec3(1.0) * (glare * glare * 0.2 + sweep * 0.07) * uStrength;

	float line = 0.5 + 0.5 * sin(vTextureCoord.y * uInputSize.y * 2.2);
	colour *= 1.0 - uScan * onArt * line * 0.55;
	colour += (hash(p * 913.0 + uTime) - 0.5) * uGrain * onArt;

	finalColor = vec4(colour * base.a, base.a);
}
`

/** The uniforms of the holographic foil filter. */
export interface HoloUniforms {
	uTilt: Float32Array
	uTime: number
	uSplit: number
	uStrength: number
	uShadow: Float32Array
	uLight: Float32Array
	uGrade: number
	uFoilTint: Float32Array
	uRainbow: number
	uFoil: number
	uScan: number
	uGrain: number
	uSparkle: number
}

/** The foil filter for a preset; `split` is the art's share of the height. */
export function createHoloFilter(look: TicketLook, split: number): Filter {
	return new Filter({
		glProgram: GlProgram.from({ vertex: VERTEX, fragment: HOLO_FRAGMENT }),
		resources: {
			holoUniforms: {
				uTilt: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
				uTime: { value: 0, type: 'f32' },
				uSplit: { value: split, type: 'f32' },
				uStrength: { value: 1, type: 'f32' },
				uShadow: { value: new Float32Array(look.shadow), type: 'vec3<f32>' },
				uLight: { value: new Float32Array(look.light), type: 'vec3<f32>' },
				uGrade: { value: look.grade, type: 'f32' },
				uFoilTint: {
					value: new Float32Array(look.foilTint),
					type: 'vec3<f32>',
				},
				uRainbow: { value: look.rainbow, type: 'f32' },
				uFoil: { value: look.foil, type: 'f32' },
				uScan: { value: look.scan, type: 'f32' },
				uGrain: { value: look.grain, type: 'f32' },
				uSparkle: { value: look.sparkle, type: 'f32' },
			},
		},
	})
}

export function holoUniformsOf(filter: Filter): HoloUniforms {
	return filter.resources.holoUniforms.uniforms
}

/** Set a preset's grading and foil on the filter's uniforms. */
export function applyLook(u: HoloUniforms, look: TicketLook): void {
	u.uShadow.set(look.shadow)
	u.uLight.set(look.light)
	u.uGrade = look.grade
	u.uFoilTint.set(look.foilTint)
	u.uRainbow = look.rainbow
	u.uFoil = look.foil
	u.uScan = look.scan
	u.uGrain = look.grain
	u.uSparkle = look.sparkle
}

/** How long the stamp's burst lasts, in seconds. */
const IMPACT_SECONDS = 1.4
/** The shockwave's height and the colour split at the moment of impact, in pixels. */
const SHOCK_AMPLITUDE = 12
const SPLIT_KICK = 4
const PARTICLES = 44
/** Seconds without input before the ticket starts to sway by itself. */
const IDLE_AFTER = 1.6

interface Particle {
	readonly node: Graphics
	vx: number
	vy: number
	life: number
}

export class TicketRenderer {
	private readonly app: Application
	private readonly root = new Container()
	private readonly art = new Container()
	private readonly artMask = new Graphics()
	private readonly backdrop = new Graphics()
	private readonly shade = new Graphics()
	private readonly paper = new Graphics()
	private readonly flash = new Graphics()
	private readonly sparks = new Container()
	private cover: Sprite | null = null
	private readonly holo: Filter
	private readonly holoUniforms: HoloUniforms
	private paperFill: FillGradient
	private shock: ShockwaveFilter | null = null
	private split: RGBSplitFilter | null = null
	private impactAge = -1
	private particles: Particle[] = []

	private width = 1
	private height = 1
	private tiltX = 0
	private tiltY = 0
	private targetX = 0
	private targetY = 0
	private sinceInput = IDLE_AFTER
	private seconds = 0
	private destroyed = false

	private constructor(
		app: Application,
		private readonly options: TicketRendererOptions,
	) {
		this.app = app
		const holo = createHoloFilter(options.look, options.split)
		this.holo = holo
		this.holoUniforms = holoUniformsOf(holo)
		this.paperFill = paperFillOf(options.look, options.paper)

		this.art.addChild(this.backdrop)
		this.art.mask = this.artMask
		this.sparks.blendMode = 'add'
		this.flash.blendMode = 'add'
		this.root.addChild(
			this.paper,
			this.art,
			this.artMask,
			this.shade,
			this.flash,
			this.sparks,
		)
		this.root.filters = [holo]
		app.stage.addChild(this.root)
		app.ticker.add((ticker) => this.tick(ticker.deltaMS / 1000))
	}

	/** Rejects when WebGL is unavailable; the ticket then stays plain DOM. */
	public static async create(
		options: TicketRendererOptions,
	): Promise<TicketRenderer> {
		const app = new Application()
		await app.init({
			canvas: options.canvas,
			width: 1,
			height: 1,
			backgroundAlpha: 0,
			antialias: true,
			autoDensity: true,
			resolution:
				options.resolution ?? Math.min(globalThis.devicePixelRatio || 1, 2),
			preference: 'webgl',
			autoStart: !options.still,
		})
		return new TicketRenderer(app, options)
	}

	/** Lay the scene out for a ticket of this size in CSS pixels. */
	public resize(width: number, height: number): void {
		if (this.destroyed || width < 1 || height < 1) return
		this.width = width
		this.height = height
		this.app.renderer.resize(width, height)
		this.root.filterArea = new Rectangle(0, 0, width, height)
		const artHeight = height * this.options.split
		const hue = this.options.hue

		this.artMask.clear().rect(0, 0, width, artHeight).fill(0xffffff)

		// Shown where there is no cover: a dark field with soft lights of the
		// performer's hue.
		this.backdrop
			.clear()
			.rect(0, 0, width, artHeight)
			.fill(hsl(hue, 45, 12))
		this.backdrop
			.circle(width * 0.25, artHeight * 0.3, width * 0.5)
			.fill({ color: hsl(hue, 85, 55), alpha: 0.55 })
			.circle(width * 0.85, artHeight * 0.55, width * 0.45)
			.fill({ color: hsl(hue + 50, 85, 60), alpha: 0.5 })
			.circle(width * 0.4, artHeight * 0.95, width * 0.4)
			.fill({ color: hsl(hue - 40, 80, 45), alpha: 0.5 })
		this.backdrop.filters = [new BlurFilter({ strength: width * 0.12 })]

		// Darkens the art's lower half, where the title sits.
		const fade = new FillGradient({
			type: 'linear',
			start: { x: 0, y: 0 },
			end: { x: 0, y: 1 },
			colorStops: [
				{ offset: 0, color: 'rgb(0 0 0 / 28%)' },
				{ offset: 0.3, color: 'rgb(0 0 0 / 0%)' },
				{ offset: 0.55, color: 'rgb(0 0 0 / 8%)' },
				{ offset: 1, color: 'rgb(0 0 0 / 82%)' },
			],
			textureSpace: 'local',
		})
		this.shade.clear().rect(0, 0, width, artHeight).fill(fade)

		this.paper
			.clear()
			.rect(0, artHeight - 1, width, height - artHeight + 1)
			.fill(this.paperFill)

		this.flash.clear().rect(0, 0, width, height).fill(0xffffff)
		this.flash.alpha = 0

		this.layoutCover()
		this.renderStill()
	}

	/** Switch to another preset: its grading, its foil and its paper. */
	public setLook(look: TicketLook, paper: number): void {
		if (this.destroyed) return
		applyLook(this.holoUniforms, look)
		this.paperFill.destroy()
		this.paperFill = paperFillOf(look, paper)
		this.resize(this.width, this.height)
	}

	/** Draw this image as the cover, or the hue backdrop when null. */
	public setCover(image: HTMLImageElement | null): void {
		if (this.destroyed) return
		if (this.cover) {
			this.cover.destroy({ texture: true, textureSource: true })
			this.cover = null
		}
		if (image) {
			this.cover = new Sprite(Texture.from(rasterize(image)))
			this.cover.anchor.set(0.5)
			this.art.addChild(this.cover)
		}
		this.layoutCover()
		this.renderStill()
	}

	/**
	 * Draw a frame now and hand out the canvas it is on. The pixels are only
	 * there until the browser next composites, so copy them at once.
	 */
	public snapshot(): HTMLCanvasElement {
		this.apply()
		this.app.render()
		return this.app.canvas
	}

	/** Tilt towards this pose, each axis in -1..1 (pointer or device motion). */
	public tiltTo(x: number, y: number): void {
		this.targetX = clamp(x)
		this.targetY = clamp(y)
		this.sinceInput = 0
		this.renderStill()
	}

	/** Let the ticket sway by itself again. */
	public release(): void {
		this.sinceInput = IDLE_AFTER
	}

	/**
	 * The stamp has landed at this point of the ticket (0-1 on each axis): a
	 * shockwave runs through the art, the colours split for a moment, and
	 * sparks fly from the point.
	 */
	public impact(x: number, y: number): void {
		if (this.destroyed || this.options.still) return
		const cx = x * this.width
		const cy = y * this.height
		this.shock = new ShockwaveFilter({
			center: { x: cx, y: cy },
			speed: Math.max(this.width, this.height) * 0.8,
			amplitude: SHOCK_AMPLITUDE,
			wavelength: this.width * 0.9,
			brightness: 1.1,
			radius: -1,
			time: 0,
		})
		this.split = new RGBSplitFilter({
			red: { x: -SPLIT_KICK, y: 0 },
			green: { x: 0, y: 0 },
			blue: { x: SPLIT_KICK, y: 0 },
		})
		this.root.filters = [this.holo, this.shock, this.split]
		this.impactAge = 0
		this.flash.alpha = 0.3

		for (const p of this.particles) p.node.destroy()
		this.particles = []
		for (let i = 0; i < PARTICLES; i++) {
			const angle = (i / PARTICLES) * Math.PI * 2 + Math.random() * 0.4
			const speed = this.width * (0.5 + Math.random() * 1.1)
			const node = new Graphics()
				.star(0, 0, 4, 2 + Math.random() * 3.5, 0.8)
				.fill(i % 3 === 0 ? 0xffffff : hsl(42 + Math.random() * 20, 100, 68))
			node.position.set(cx, cy)
			node.rotation = Math.random() * Math.PI
			this.sparks.addChild(node)
			this.particles.push({
				node,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed - this.width * 0.25,
				life: 0.6 + Math.random() * 0.5,
			})
		}
	}

	public destroy(): void {
		if (this.destroyed) return
		this.destroyed = true
		// The canvas belongs to the component's template.
		this.app.destroy({ removeView: false }, { children: true, texture: true })
	}

	private layoutCover(): void {
		const cover = this.cover
		if (!cover) return
		const artHeight = this.height * this.options.split
		const { width: w, height: h } = cover.texture
		if (!w || !h) return
		// Like `object-fit: cover`, a little larger so parallax never shows an edge.
		const scale = Math.max(this.width / w, artHeight / h) * 1.14
		cover.scale.set(scale)
		this.placeCover()
	}

	private placeCover(): void {
		const artHeight = this.height * this.options.split
		this.cover?.position.set(
			this.width / 2 - this.tiltX * this.width * 0.045,
			artHeight / 2 - this.tiltY * artHeight * 0.045,
		)
	}

	private renderStill(): void {
		if (!this.options.still || this.destroyed) return
		this.tiltX = this.targetX
		this.tiltY = this.targetY
		this.apply()
		this.app.render()
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
		this.apply()
		this.stepImpact(dt)
	}

	private apply(): void {
		this.holoUniforms.uTilt[0] = this.tiltX
		this.holoUniforms.uTilt[1] = this.tiltY
		this.holoUniforms.uTime = this.seconds
		this.placeCover()
		this.options.onTilt?.(this.tiltX, this.tiltY)
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
		this.flash.alpha = 0.3 * Math.max(0, 1 - this.impactAge / 0.4) ** 2
		this.holoUniforms.uStrength = 1 + fade * 0.6

		const gravity = this.width * 1.6
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
			this.root.filters = [this.holo]
			this.shock = null
			this.split = null
			this.holoUniforms.uStrength = 1
			for (const p of this.particles) p.node.destroy()
			this.particles = []
		}
	}
}

function paperFillOf(look: TicketLook, paper: number): FillGradient {
	const [top, bottom] = look.paper ?? [paper, paper]
	return new FillGradient({
		type: 'linear',
		start: { x: 0, y: 0 },
		end: { x: 0, y: 1 },
		colorStops: [
			{ offset: 0, color: top },
			{ offset: 1, color: bottom },
		],
		textureSpace: 'local',
	})
}

/** The longest side of the cover's texture, in pixels. */
const COVER_TEXTURE_MAX = 1280

/**
 * The image as a canvas no larger than the texture needs. A canvas uploads
 * to WebGL whatever the image's format (an SVG image does not), and a large
 * photo no longer costs its full size in GPU memory.
 */
function rasterize(image: HTMLImageElement): HTMLCanvasElement {
	const scale = Math.min(
		1,
		COVER_TEXTURE_MAX / Math.max(image.naturalWidth, image.naturalHeight),
	)
	const canvas = document.createElement('canvas')
	canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
	canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
	canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
	return canvas
}

function clamp(v: number): number {
	return Math.max(-1, Math.min(1, v))
}

/** An HSL colour as a CSS string PixiJS parses. */
function hsl(hue: number, saturation: number, lightness: number): string {
	return `hsl(${((hue % 360) + 360) % 360} ${saturation}% ${lightness}%)`
}
