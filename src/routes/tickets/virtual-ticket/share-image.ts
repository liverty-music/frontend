import { DI } from 'aurelia'

/** The file name the share image is handed over with. */
export const SHARE_FILE_NAME = 'liverty-ticket.png'

/**
 * What became of a share: handed to the share sheet, downloaded (no file
 * sharing in this browser), or the fan closed the share sheet.
 */
export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled'

/** The browser features making and handing over the image depends on. */
export interface ShareImageEnv {
	/**
	 * Draw the copy of `face` over the art into a PNG. `face` is the live
	 * front, measured for the size; it is never changed. `art` is the front's
	 * art and paper as a picture, or null when WebGL could not draw it.
	 */
	render(
		clone: HTMLElement,
		face: HTMLElement,
		art: HTMLCanvasElement | null,
	): Promise<Blob>
	readonly navigator: Pick<Navigator, 'share' | 'canShare'>
	download(file: File): void
}

/** Device pixels per CSS pixel of the image: sharp on phones, bounded in size. */
export function shareImageScale(): number {
	return Math.min(Math.max(globalThis.devicePixelRatio || 1, 2), 3)
}

/**
 * A copy of the front for the share image. The front holds no personal
 * details, so nothing is masked. The copy leaves out what the image draws by
 * itself or does not show: the cover and the art's canvas (the art is drawn
 * under the copy) and the admission stamp.
 */
export function shareClone(face: HTMLElement): HTMLElement {
	const clone = face.cloneNode(true) as HTMLElement
	clone.setAttribute('data-share', '')
	clone.removeAttribute('id')
	clone.removeAttribute('inert')
	// Without the stamp the stub's bars are whole again.
	clone.removeAttribute('data-entered')
	for (const el of clone.querySelectorAll('[id]')) el.removeAttribute('id')
	for (const el of clone.querySelectorAll(
		'admission-stamp, canvas, .ticket-front-cover',
	)) {
		el.remove()
	}
	return clone
}

/**
 * Makes the share image of a virtual ticket and hands it to the device: the
 * share sheet as a PNG file where the browser can share files, a download
 * otherwise. The image is the ticket's front, which holds no personal
 * details; the live front is never changed (see {@link shareClone}).
 */
export class ShareImage {
	constructor(private readonly env: ShareImageEnv = browserEnv()) {}

	public async share(
		face: HTMLElement,
		art: HTMLCanvasElement | null,
	): Promise<ShareOutcome> {
		const blob = await this.env.render(shareClone(face), face, art)
		return await this.handOff(
			new File([blob], SHARE_FILE_NAME, { type: 'image/png' }),
		)
	}

	private async handOff(file: File): Promise<ShareOutcome> {
		const nav = this.env.navigator
		const data: ShareData = { files: [file] }
		if (typeof nav.canShare === 'function' && nav.canShare(data)) {
			try {
				await nav.share(data)
				return 'shared'
			} catch (err) {
				if (err instanceof DOMException && err.name === 'AbortError') {
					return 'cancelled'
				}
				throw err
			}
		}
		this.env.download(file)
		return 'downloaded'
	}
}

export const IShareImage = DI.createInterface<IShareImage>('IShareImage', (x) =>
	x.singleton(ShareImage),
)
export interface IShareImage extends ShareImage {}

// ── Browser implementation ─────────────────────────────────────────────────

function browserEnv(): ShareImageEnv {
	return {
		render: renderShareImage,
		navigator,
		download,
	}
}

function download(file: File): void {
	const url = URL.createObjectURL(file)
	const a = document.createElement('a')
	a.href = url
	a.download = file.name
	document.body.append(a)
	a.click()
	a.remove()
	// Revoke once the browser has started the download.
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Draw the copy into a PNG.
 *
 * 1. Mount the copy off screen inside a `virtual-ticket` element and a copy
 *    of the card, so the ticket's scoped stylesheets and its preset apply,
 *    and inline every computed style: an SVG image cannot reach the page's
 *    stylesheets. It cannot reach the page's fonts either, so the faces the
 *    copy is set in are embedded in the image.
 * 2. Serialise it into an SVG `foreignObject` image.
 * 3. On the canvas, draw the art (or, without WebGL, the paper and the plain
 *    cover), then the SVG image over it, and cut the ticket's outline: its
 *    round corners and the two notches of the tear.
 */
export async function renderShareImage(
	clone: HTMLElement,
	face: HTMLElement,
	art: HTMLCanvasElement | null,
): Promise<Blob> {
	const doc = face.ownerDocument
	// The layout size: the ticket may be scaled to fit its stage, or drawn
	// as a sheet, and neither changes what it measures here.
	const width = face.offsetWidth
	const height = face.offsetHeight
	const host = doc.createElement('virtual-ticket')
	host.setAttribute('aria-hidden', 'true')
	host.inert = true
	host.style.cssText =
		'position:fixed;inset-block-start:0;inset-inline-start:-100000px;pointer-events:none'
	const card = face.closest('.virtual-ticket-card')?.cloneNode(false) as
		| HTMLElement
		| undefined
	const shell = card ?? doc.createElement('div')
	for (const name of ['data-side', 'data-sheeted', 'data-thump']) {
		shell.removeAttribute(name)
	}
	shell.style.cssText += `;position:relative;inset:auto;transform:none;transition:none;animation:none;inline-size:${width}px;block-size:${height}px`
	shell.append(clone)
	host.append(shell)
	doc.body.append(host)
	let families: Set<string>
	try {
		families = inlineStyles(clone)
	} finally {
		host.remove()
	}
	// The art is drawn under the copy, with the paper in it; the outline is
	// cut on the canvas.
	clone.style.background = 'none'
	clone.style.mask = 'none'

	// Scale with a CSS transform inside the foreignObject, not with the SVG's
	// viewBox: WebKit does not scale foreignObject content by the viewBox and
	// draws the face at 1x in the corner.
	const scale = shareImageScale()
	const w = Math.round(width * scale)
	const h = Math.round(height * scale)
	const frame = doc.createElement('div')
	frame.setAttribute(
		'style',
		`position:relative;inline-size:${width}px;block-size:${height}px;transform:scale(${scale});transform-origin:0 0`,
	)
	const fonts = doc.createElement('style')
	fonts.textContent = await embeddedFonts(doc, families)
	frame.append(fonts, clone)
	const markup = new XMLSerializer().serializeToString(frame)
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${markup}</foreignObject></svg>`
	const image = new Image()
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
	await image.decode()

	const canvas = doc.createElement('canvas')
	canvas.width = w
	canvas.height = h
	const ctx = canvas.getContext('2d')
	if (!ctx) throw new Error('2d canvas unavailable')
	ctx.scale(scale, scale)
	const style = getComputedStyle(face)
	const radius = Number.parseFloat(style.borderTopLeftRadius)
	if (radius > 0 && typeof ctx.roundRect === 'function') {
		ctx.beginPath()
		ctx.roundRect(0, 0, width, height, radius)
		ctx.clip()
	}
	if (art) ctx.drawImage(art, 0, 0, width, height)
	else drawPlainArt(ctx, face, width, height)
	ctx.drawImage(image, 0, 0, width, height)

	// The notches: `--_tear` is a share of the height, `--_notch` in rem.
	const tear = Number.parseFloat(style.getPropertyValue('--_tear')) / 100
	const notch =
		Number.parseFloat(style.getPropertyValue('--_notch')) *
		Number.parseFloat(getComputedStyle(doc.documentElement).fontSize)
	if (tear > 0 && notch > 0) {
		ctx.globalCompositeOperation = 'destination-out'
		for (const x of [0, width]) {
			ctx.beginPath()
			ctx.arc(x, height * tear, notch, 0, Math.PI * 2)
			ctx.fill()
		}
	}

	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
			'image/png',
		)
	})
}

/**
 * The front without WebGL: its paper, and over the art's part the cover as
 * the page shows it (or the dark field of an event without one), darkened
 * towards its foot where the headline sits.
 */
function drawPlainArt(
	ctx: CanvasRenderingContext2D,
	face: HTMLElement,
	width: number,
	height: number,
): void {
	ctx.fillStyle = getComputedStyle(face).backgroundColor
	ctx.fillRect(0, 0, width, height)
	const artHeight =
		face.querySelector<HTMLElement>('.ticket-front-art')?.offsetHeight ?? 0
	if (!artHeight) return
	const cover = face.querySelector<HTMLImageElement>(
		'.ticket-front-cover-image',
	)
	if (cover?.complete && cover.naturalWidth > 0) {
		drawCovering(
			ctx,
			cover,
			cover.naturalWidth,
			cover.naturalHeight,
			width,
			artHeight,
		)
	} else {
		ctx.fillStyle = '#1c1c22'
		ctx.fillRect(0, 0, width, artHeight)
	}
	const shade = ctx.createLinearGradient(0, 0, 0, artHeight)
	shade.addColorStop(0, 'rgb(0 0 0 / 28%)')
	shade.addColorStop(0.3, 'rgb(0 0 0 / 0%)')
	shade.addColorStop(1, 'rgb(0 0 0 / 82%)')
	ctx.fillStyle = shade
	ctx.fillRect(0, 0, width, artHeight)
}

/** Draw `source` over the top of the canvas, cropped as `object-fit: cover` crops it. */
function drawCovering(
	ctx: CanvasRenderingContext2D,
	source: CanvasImageSource,
	sourceWidth: number,
	sourceHeight: number,
	width: number,
	height: number,
): void {
	const ratio = Math.max(width / sourceWidth, height / sourceHeight)
	const sw = width / ratio
	const sh = height / ratio
	ctx.drawImage(
		source,
		(sourceWidth - sw) / 2,
		(sourceHeight - sh) / 2,
		sw,
		sh,
		0,
		0,
		width,
		height,
	)
}

/**
 * Copy every computed property onto each element's `style` attribute, and
 * return the font families the elements are set in (lower-cased). Every
 * style is read before any is written: writing an element's `style` first
 * could drop a custom property the styles inside it are computed from.
 */
function inlineStyles(root: HTMLElement): Set<string> {
	const elements = [root, ...root.querySelectorAll<HTMLElement>('*')]
	const families = new Set<string>()
	const styles = elements.map((el) => {
		const computed = getComputedStyle(el)
		for (const family of computed.fontFamily.split(',')) {
			families.add(familyKey(family))
		}
		let css = ''
		for (let i = 0; i < computed.length; i++) {
			const name = computed[i]
			if (name.startsWith('--')) continue
			css += `${name}:${computed.getPropertyValue(name)};`
		}
		return css
	})
	elements.forEach((el, i) => {
		el.setAttribute('style', styles[i])
	})
	return families
}

function familyKey(family: string): string {
	return family
		.trim()
		.replace(/^["']|["']$/g, '')
		.toLowerCase()
}

/** What tells one `@font-face` from another: family, weight, style and range. */
function faceKey(
	family: string,
	weight: string,
	style: string,
	range: string,
): string {
	return [
		familyKey(family),
		weight.trim() || '400',
		style.trim() || 'normal',
		range.replace(/\s+/g, '').toLowerCase(),
	].join('|')
}

/**
 * `@font-face` rules for the image: every face of `families` the page has
 * loaded, with its file inlined as a data URL. A face that is not loaded is
 * not used by the page's text, and a file that cannot be read is left out;
 * the image then falls back as the page would.
 */
async function embeddedFonts(
	doc: Document,
	families: ReadonlySet<string>,
): Promise<string> {
	if (!doc.fonts || typeof CSSFontFaceRule === 'undefined') return ''
	const loaded = new Set<string>()
	for (const face of doc.fonts) {
		if (face.status === 'loaded') {
			loaded.add(
				faceKey(face.family, face.weight, face.style, face.unicodeRange),
			)
		}
	}
	const wanted: { rule: CSSFontFaceRule; base: string }[] = []
	const collect = (rules: CSSRuleList, base: string): void => {
		for (const rule of rules) {
			if (rule instanceof CSSFontFaceRule) {
				const s = rule.style
				const family = s.getPropertyValue('font-family')
				const key = faceKey(
					family,
					s.getPropertyValue('font-weight'),
					s.getPropertyValue('font-style'),
					s.getPropertyValue('unicode-range') || 'U+0-10FFFF',
				)
				if (families.has(familyKey(family)) && loaded.has(key)) {
					wanted.push({ rule, base })
				}
			} else if ('cssRules' in rule) {
				collect((rule as CSSGroupingRule).cssRules, base)
			}
		}
	}
	for (const sheet of doc.styleSheets) {
		try {
			collect(sheet.cssRules, sheet.href ?? doc.baseURI)
		} catch {
			// A stylesheet of another origin cannot be read.
		}
	}
	const rules = await Promise.all(
		wanted.map(async ({ rule, base }) => {
			const s = rule.style
			const source = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(
				s.getPropertyValue('src'),
			)?.[1]
			if (!source) return ''
			try {
				const res = await fetch(new URL(source, base))
				if (!res.ok) return ''
				const data = await dataUrl(await res.blob())
				const range = s.getPropertyValue('unicode-range')
				return `@font-face{font-family:${s.getPropertyValue('font-family')};font-weight:${s.getPropertyValue('font-weight') || '400'};font-style:${s.getPropertyValue('font-style') || 'normal'};${range ? `unicode-range:${range};` : ''}src:url(${data})}`
			} catch {
				return ''
			}
		}),
	)
	return rules.join('')
}

function dataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(String(reader.result))
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(blob)
	})
}
