import { I18N } from '@aurelia/i18n'
import { BindingMode, bindable, ILogger, INode, resolve } from 'aurelia'
import { artistHue } from '../../../adapter/view/artist-color'
import { toDomesticDisplay } from '../../../lib/to-e164'
import { currentLanguage } from '../../../util/change-locale'
import {
	type EventPageEvent,
	formatEventDate,
	formatEventTime,
	prefectureLabel,
} from '../../event/event-page'
import type { WalletPersonalDetails, WalletTicket } from '../wallet-view'
import { STAMP_ANIMATION } from './admission-stamp'
import { ticketSize } from './share-image'
import { TICKET_LOOKS, type TicketPreset } from './ticket-presets'
import type { TicketRenderer } from './ticket-renderer'
import type { TicketSheetRenderer } from './ticket-sheet-renderer'

/** Dispatched on the host when the stamp's pressing animation has played to its end. */
export const STAMP_PRESSED = 'stamp-pressed'
/** Dispatched on the host when the fan picks a design; `detail.preset` is the pick. */
export const PRESET_CHOSEN = 'preset-chosen'

/** The art's share of the front's height; the stub below it is the rest. */
const ART_SPLIT = 0.54
/** The room around the ticket on the sheet's canvas, in CSS pixels. */
const SHEET_MARGIN = 56
/** The stamp lands this far into its pressing animation (its 20% keyframe). */
const STAMP_LANDS_AT = 0.2
/** A stamp that landed longer ago than this gets no impact (reopened late). */
const IMPACT_LATE_MS = 250
/**
 * The stamp's centre on the front at the design size (20rem by 34rem): a
 * 6.5rem seal, 6% from the right edge and 2.5% from the foot
 * (admission-stamp.css).
 */
const STAMP_CENTRE: [number, number] = [
	1 - 0.06 - 6.5 / 20 / 2,
	1 - 0.025 - 6.5 / 34 / 2,
]

/** The pose the share image is drawn in, each axis in -1..1. */
const SHARE_TILT = [-0.7, -0.6] as const

let nextId = 0

/**
 * One ticket as a collectible with two sides.
 *
 * The front is the keepsake: the event's cover image under a holographic
 * foil that follows the ticket's tilt, the performers and title, the date,
 * the venue and its prefecture, the open and start times, the seat type and
 * that no seat is assigned. It holds no personal details, no QR code and no
 * ticket id, so the share image is made from the front as it is.
 *
 * The back is the 特定興行入場券 face: the same event and seat items with the
 * eligible person's full name and phone number, that paid transfer without
 * the organizer's consent is prohibited, and that the eligible person's name
 * and contact details were confirmed at the sale.
 *
 * Every item is text, so it can be selected and is read by a screen reader.
 * The art and its effects are drawn with WebGL under that text; without
 * WebGL the front shows the cover as an ordinary image.
 *
 * A ticket that is 入場済み carries the admission stamp on its front: 入場済
 * ringed by the event's date. With `pressStamp` the stamp is pressed onto the front
 * (about 1.5 s) and the host then dispatches `stamp-pressed`; without it, or
 * when the fan has asked to reduce motion, the stamp is shown at rest and
 * nothing is dispatched.
 */
export class VirtualTicket {
	/** The ticket's event; null when its details could not be read. */
	@bindable public event: EventPageEvent | null = null
	@bindable public ticket: WalletTicket | null = null
	@bindable public personalDetails: WalletPersonalDetails | null = null
	/** The design preset, by the kind of concert. */
	@bindable({ mode: BindingMode.twoWay })
	public preset: TicketPreset = 'default'
	public readonly presetOptions = Object.keys(TICKET_LOOKS) as TicketPreset[]
	/**
	 * How the ticket is drawn. `canvas` draws the whole ticket, text included,
	 * as a sheet in WebGL with HTML-in-Canvas, so it can bend as it turns
	 * over; a browser without HTML-in-Canvas (Safari, Firefox) falls back to
	 * `dom`, which keeps both sides in the page and draws only the art with
	 * WebGL. A fan who asked to reduce motion gets `dom`, which stays still.
	 */
	@bindable public drawing: 'dom' | 'canvas' = 'canvas'
	/** Press the stamp with its animation rather than show it at rest. */
	@bindable public pressStamp = false

	private readonly i18n = resolve(I18N)
	private readonly host = resolve(INode) as HTMLElement
	private readonly logger = resolve(ILogger).scopeTo('VirtualTicket')

	public readonly titleId = `virtual-ticket-title-${++nextId}`

	/** Bound via `ref`: the front, the element the share image is made from. */
	public face?: HTMLElement
	/** Bound via `ref`: the cover image, drawn into the art and the share image. */
	public coverImage?: HTMLImageElement
	/** Bound via `ref`: the canvas the art is drawn on. */
	public canvas?: HTMLCanvasElement
	/** Bound via `ref`: the box the card is laid out in at its design size. */
	public fit?: HTMLElement
	/** Bound via `ref`: the element that tilts and flips. */
	public card?: HTMLElement
	/** Bound via `ref`: the back. */
	public back?: HTMLElement
	/** The whole ticket is drawn as a sheet with HTML-in-Canvas. */
	public sheeted = false

	/** The cover image failed to load (no connection, or gone). */
	public coverFailed = false
	/** Which side faces the fan. */
	public side: 'front' | 'back' = 'front'
	/** The art is being drawn with WebGL; the plain cover image is hidden. */
	public drawn = false

	private renderer: TicketRenderer | null = null
	private sheet: TicketSheetRenderer | null = null
	private resizeObserver: ResizeObserver | null = null
	private stampTimer: ReturnType<typeof setTimeout> | undefined
	/** The pressing animation whose impact has been drawn. */
	private impactedPress: Animation | null = null
	private detached = false
	private askedForTilt = false

	public eventChanged(): void {
		this.coverFailed = false
	}

	public attached(): void {
		this.detached = false
		// The presets' display faces; the ticket is set in the fallback face
		// until they arrive, or for good when they cannot be loaded.
		void import('./ticket-fonts').catch(() => undefined)
		if (followsDeviceTilt()) {
			addEventListener('deviceorientation', this.onDeviceTilt)
		}
		void this.start()
	}

	/**
	 * Tilt the ticket as the device is tilted: level across, and held at about
	 * 45 degrees, is the ticket at rest.
	 */
	private readonly onDeviceTilt = (event: DeviceOrientationEvent): void => {
		if (event.beta === null || event.gamma === null) return
		const x = event.gamma / 30
		const y = (event.beta - 45) / 30
		this.renderer?.tiltTo(x, y)
		this.sheet?.tiltTo(x, y)
	}

	/**
	 * The art first, in every way of drawing: drawn as a sheet, the front
	 * (art included) is taken into the sheet, which then only adds its bend
	 * and a light foil.
	 */
	private async start(): Promise<void> {
		await this.startRenderer()
		if (this.drawing === 'canvas' && !reducedMotion() && !this.detached) {
			await this.startSheet()
		}
	}

	/**
	 * Draw the whole ticket as a sheet: move the card into a canvas, whose
	 * descendants the browser lays out and paints into WebGL textures.
	 * Resolves to false when the browser cannot, leaving the DOM untouched.
	 */
	private async startSheet(): Promise<boolean> {
		const { card, face, back, fit } = this
		if (!card || !face || !back || !fit) return false
		try {
			const { TicketSheetRenderer, sheetSupported } = await import(
				'./ticket-sheet-renderer'
			)
			if (!sheetSupported() || this.detached) return false
			const width = fit.clientWidth
			const height = fit.clientHeight
			const canvas = document.createElement('canvas')
			canvas.className = 'virtual-ticket-sheet'
			canvas.style.setProperty('--sheet-margin', `${SHEET_MARGIN}px`)
			fit.append(canvas)
			canvas.append(card)
			this.sheeted = true
			this.sheet = await TicketSheetRenderer.create({
				canvas,
				front: face,
				back,
				width,
				height,
				margin: SHEET_MARGIN,
				look: TICKET_LOOKS[this.preset] ?? TICKET_LOOKS.default,
				split: ART_SPLIT,
				resolution: this.drawResolution(),
			})
			if (this.detached) {
				this.sheet.destroy()
				this.sheet = null
				return true
			}
			this.sheet.showBack(this.isBack)
			if (this.pressing) this.scheduleImpact()
			return true
		} catch (err) {
			this.logger.warn('Drawing the ticket as a sheet failed', { error: err })
			this.sheet = null
			this.leaveSheet()
			return false
		}
	}

	/**
	 * Put the card back where the template has it and drop the sheet's
	 * canvas. The view is kept and attached again when the ticket is
	 * reopened, so the next start must find the DOM as the template made it.
	 */
	private leaveSheet(): void {
		const { card, fit } = this
		if (!this.sheeted || !card || !fit) return
		const canvas = card.parentElement
		fit.append(card)
		if (canvas !== fit) canvas?.remove()
		this.sheeted = false
	}

	public detaching(): void {
		this.detached = true
		removeEventListener('deviceorientation', this.onDeviceTilt)
		clearTimeout(this.stampTimer)
		this.resizeObserver?.disconnect()
		this.resizeObserver = null
		this.renderer?.destroy()
		this.renderer = null
		this.sheet?.destroy()
		this.sheet = null
		this.leaveSheet()
		this.drawn = false
	}

	/**
	 * Draw the art with WebGL. PixiJS is loaded only here; when it cannot
	 * load or WebGL is unavailable, the front stays as plain DOM.
	 */
	private async startRenderer(): Promise<void> {
		const canvas = this.canvas
		const face = this.face
		const fit = this.fit
		if (!canvas || !face || !fit || typeof ResizeObserver === 'undefined')
			return
		try {
			const { TicketRenderer } = await import('./ticket-renderer')
			const renderer = await TicketRenderer.create({
				canvas,
				hue: this.hue,
				paper: rgbOf(getComputedStyle(face).backgroundColor),
				look: TICKET_LOOKS[this.preset] ?? TICKET_LOOKS.default,
				split: ART_SPLIT,
				still: reducedMotion(),
				resolution: this.drawResolution(),
				onTilt: (x, y) => this.onTilt(x, y),
			})
			if (this.detached) {
				renderer.destroy()
				return
			}
			this.renderer = renderer
			// Measured on the box the card is laid out in: the front reports no
			// size once it is inside the sheet's canvas.
			const resize = () => {
				const { width, height } = ticketSize(face)
				renderer.resize(width, height)
			}
			this.resizeObserver = new ResizeObserver(resize)
			this.resizeObserver.observe(fit)
			resize()
			this.drawCover()
			this.drawn = true
			if (this.pressing) this.scheduleImpact()
		} catch (err) {
			// Said aloud: a silent fall back to the plain cover hid a renderer
			// that could not start in the app at all.
			this.logger.warn('Drawing the art with WebGL failed', { error: err })
			this.drawn = false
		}
	}

	/**
	 * The front's art and paper as one still picture for the share image, at
	 * `scale` device pixels per CSS pixel: drawn with WebGL like the art on
	 * screen, without tilt. Null when WebGL cannot draw it.
	 */
	public async shareArt(scale: number): Promise<HTMLCanvasElement | null> {
		const face = this.face
		if (!face) return null
		const { width, height } = ticketSize(face)
		const picture = document.createElement('canvas')
		picture.width = Math.round(width * scale)
		picture.height = Math.round(height * scale)
		const context = picture.getContext('2d')
		if (!context || !width || !height) return null
		let renderer: TicketRenderer | null = null
		try {
			const { TicketRenderer } = await import('./ticket-renderer')
			renderer = await TicketRenderer.create({
				canvas: document.createElement('canvas'),
				hue: this.hue,
				paper: rgbOf(getComputedStyle(face).backgroundColor),
				look: TICKET_LOOKS[this.preset] ?? TICKET_LOOKS.default,
				split: ART_SPLIT,
				still: true,
				resolution: scale,
			})
			renderer.resize(width, height)
			const image = this.coverImage
			if (image?.complete && image.naturalWidth > 0 && this.showsCover) {
				renderer.setCover(image)
			}
			// Turned a little from the light, so the foil's glare lies off the
			// headline.
			renderer.tiltTo(SHARE_TILT[0], SHARE_TILT[1])
			context.drawImage(
				renderer.snapshot(),
				0,
				0,
				picture.width,
				picture.height,
			)
			return picture
		} catch (err) {
			this.logger.warn('Drawing the share image art failed', { error: err })
			return null
		} finally {
			renderer?.destroy()
		}
	}

	/**
	 * Device pixels per CSS pixel the ticket is drawn at. The ticket is laid
	 * out at its design size and scaled up to its stage, so the screen's own
	 * ratio alone would draw it soft; 3 bounds the cost on a dense screen.
	 */
	private drawResolution(): number {
		const fit = this.fit
		const zoom = fit?.clientWidth
			? fit.getBoundingClientRect().width / fit.clientWidth
			: 1
		return Math.min((globalThis.devicePixelRatio || 1) * Math.max(zoom, 1), 3)
	}

	/** Hand the loaded cover image to the renderer. */
	public drawCover(): void {
		const image = this.coverImage
		const loaded = !!image && image.complete && image.naturalWidth > 0
		this.renderer?.setCover(loaded && this.showsCover ? image : null)
	}

	private onTilt(x: number, y: number): void {
		this.card?.style.setProperty('--tilt-x', x.toFixed(3))
		this.card?.style.setProperty('--tilt-y', y.toFixed(3))
	}

	/** The first touch of the ticket: ask for the device's tilt, once. */
	public onPointerDown(): void {
		if (this.askedForTilt || !followsDeviceTilt()) return
		this.askedForTilt = true
		void askForDeviceTilt()
	}

	/** Tilt the ticket towards the pointer. */
	public onPointerMove(event: PointerEvent): void {
		const rect = this.card?.getBoundingClientRect()
		if (!rect?.width || !rect.height) return
		const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
		const y = ((event.clientY - rect.top) / rect.height) * 2 - 1
		this.renderer?.tiltTo(x, y)
		this.sheet?.tiltTo(x, y)
	}

	public onPointerLeave(): void {
		this.renderer?.release()
		this.sheet?.release()
	}

	public choosePreset(preset: TicketPreset): void {
		if (preset === this.preset) return
		this.preset = preset
		this.host.dispatchEvent(
			new CustomEvent(PRESET_CHOSEN, { bubbles: true, detail: { preset } }),
		)
	}

	/**
	 * A tap on the ticket turns it over. A drag that selected text, or a tap
	 * on something that acts by itself, does not.
	 */
	public onTap(event: MouseEvent): void {
		if (getSelection()?.toString()) return
		if ((event.target as Element).closest?.('a, button')) return
		this.flip()
	}

	/** Redraw the art in the new preset once its CSS has applied. */
	public presetChanged(): void {
		this.sheet?.setLook(TICKET_LOOKS[this.preset] ?? TICKET_LOOKS.default)
		const face = this.face
		if (!face || !this.renderer) return
		requestAnimationFrame(() => {
			this.renderer?.setLook(
				TICKET_LOOKS[this.preset] ?? TICKET_LOOKS.default,
				rgbOf(getComputedStyle(face).backgroundColor),
			)
		})
	}

	/** Turn the ticket over. */
	public flip(): void {
		this.side = this.side === 'front' ? 'back' : 'front'
		this.sheet?.showBack(this.isBack)
	}

	public get isBack(): boolean {
		return this.side === 'back'
	}

	public pressStampChanged(): void {
		if (this.pressing && (this.renderer || this.sheet)) this.scheduleImpact()
	}

	/** Burst from where the stamp sits, at the moment it lands. */
	private scheduleImpact(): void {
		clearTimeout(this.stampTimer)
		const stamp = this.face?.querySelector<HTMLElement>('.admission-stamp')
		if (!stamp) return
		// Timed from the stamp's own animation, which started when the ticket
		// opened: the renderers start later, and each asks for the impact
		// again once it is ready, so the delay must not restart with them.
		const press = stamp
			.getAnimations()
			.find((a) => (a as CSSAnimation).animationName === STAMP_ANIMATION)
		const seconds = Number.parseFloat(getComputedStyle(stamp).animationDuration)
		const landsAt =
			(Number.isFinite(seconds) ? seconds : 1.5) * 1000 * STAMP_LANDS_AT
		const elapsed = Number(press?.currentTime ?? 0)
		if (press && elapsed > landsAt + IMPACT_LATE_MS) return
		// One impact per pressing, whichever renderer was ready for it.
		if (press && press === this.impactedPress) return
		this.stampTimer = setTimeout(
			() => {
				this.impactedPress = press ?? null
				const [x, y] = this.stampCentre(stamp)
				// One shockwave: the sheet's runs through the whole ticket, the
				// art's through the art alone.
				if (this.sheet) this.sheet.impact(x, y)
				else this.renderer?.impact(x, y)
				this.card?.setAttribute('data-thump', '')
			},
			Math.max(0, landsAt - elapsed),
		)
	}

	/**
	 * Where the stamp sits on the front, 0-1 on each axis. Inside the sheet's
	 * canvas no element reports a box, so there it comes from the stamp's
	 * place in the layout (admission-stamp.css) at the design size.
	 */
	private stampCentre(stamp: HTMLElement): [number, number] {
		const face = this.face?.getBoundingClientRect()
		const at = stamp.getBoundingClientRect()
		if (face?.width && face.height && at.width) {
			return [
				(at.left + at.width / 2 - face.left) / face.width,
				(at.top + at.height / 2 - face.top) / face.height,
			]
		}
		return STAMP_CENTRE
	}

	public get showsCover(): boolean {
		return !!this.event?.coverUrl && !this.coverFailed
	}

	public onCoverError(): void {
		this.coverFailed = true
		this.renderer?.setCover(null)
	}

	/** The event's date as it is printed on the front, e.g. "2026.12.20". */
	public get stubDate(): string {
		const key = this.event?.dateKey
		return key ? key.replaceAll('-', '.') : ''
	}

	/** The event's weekday in the fan's language, e.g. "日" or "Sun". */
	public get weekday(): string {
		const date = this.event?.date
		return date
			? new Intl.DateTimeFormat(this.lang, { weekday: 'short' }).format(date)
			: ''
	}

	/** The hue of the face's lower part: the first performer's, as on the event cards. */
	public get hue(): number {
		const first = this.event?.performers[0]?.name
		return first ? artistHue(first) : 0
	}

	public get performers(): string {
		return (this.event?.performers ?? []).map((p) => p.name).join(' / ')
	}

	private get lang(): string {
		return currentLanguage(this.i18n)
	}

	public get date(): string {
		return this.event ? formatEventDate(this.event, this.lang) : ''
	}

	public get prefecture(): string {
		return this.event ? prefectureLabel(this.event, this.lang) : ''
	}

	public time(value: Date | undefined): string {
		return value ? formatEventTime(value) : ''
	}

	public get phoneNumber(): string {
		const phone = this.personalDetails?.phoneNumber
		return phone ? toDomesticDisplay(phone) : ''
	}

	public get entered(): boolean {
		return this.ticket?.state === 'entered'
	}

	/**
	 * Whether the stamp is being pressed: asked for, on an entered ticket, and
	 * the fan has not asked the device to reduce motion.
	 */
	public get pressing(): boolean {
		return this.pressStamp && this.entered && !reducedMotion()
	}

	public onStampAnimationEnd(event: AnimationEvent): void {
		if (event.animationName !== STAMP_ANIMATION || !this.pressing) return
		this.card?.removeAttribute('data-thump')
		this.host.dispatchEvent(
			new CustomEvent(STAMP_PRESSED, {
				bubbles: true,
				detail: { ticketId: this.ticket?.id ?? '' },
			}),
		)
	}
}

/** A CSS colour (any syntax the browser knows, e.g. oklch) as 0xRRGGBB. */
function rgbOf(color: string): number {
	const canvas = document.createElement('canvas')
	canvas.width = 1
	canvas.height = 1
	const context = canvas.getContext('2d', { willReadFrequently: true })
	if (!context) return 0xffffff
	context.fillStyle = color
	context.fillRect(0, 0, 1, 1)
	const [r, g, b] = context.getImageData(0, 0, 1, 1).data
	return (r << 16) | (g << 8) | b
}

/**
 * Whether the ticket follows the device's tilt: wherever the browser has
 * the orientation event, unless the fan asked to reduce motion. Listening
 * asks for nothing; where the events need a permission that was not given
 * (Safari on iOS), none arrive and the ticket sways by itself.
 */
function followsDeviceTilt(): boolean {
	return typeof DeviceOrientationEvent !== 'undefined' && !reducedMotion()
}

/** `DeviceOrientationEvent` with the permission request newer browsers have. */
type OrientationPermission = typeof DeviceOrientationEvent & {
	requestPermission?: () => Promise<PermissionState>
}

/**
 * Ask for the orientation events where that cannot open a dialog. Chrome has
 * `requestPermission()` since 121 and may hold the events back until it is
 * called, but grants the sensors by default; Safari on iOS answers the same
 * call with a dialog, which a ticket is not worth. So the call is made only
 * when the browser already reports the sensor as granted, which Safari does
 * not report at all. Must run in a user gesture.
 */
async function askForDeviceTilt(): Promise<void> {
	const request = (DeviceOrientationEvent as OrientationPermission)
		.requestPermission
	if (typeof request !== 'function') return
	try {
		const status = await navigator.permissions.query({
			name: 'accelerometer' as PermissionName,
		})
		if (status.state === 'granted') await request()
	} catch {
		// The browser does not report the sensor: do not ask.
	}
}

function reducedMotion(): boolean {
	return (
		typeof matchMedia === 'function' &&
		matchMedia('(prefers-reduced-motion: reduce)').matches
	)
}
