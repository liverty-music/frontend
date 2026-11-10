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
	/** The cover as a bitmap, or null when it cannot be fetched or decoded. */
	fetchCover(url: string): Promise<ImageBitmap | null>
	/**
	 * Draw the masked clone of `face` over the cover into a PNG. `face` is
	 * the live face, measured for the size and the cover's rectangle; it is
	 * never changed.
	 */
	render(
		clone: HTMLElement,
		face: HTMLElement,
		cover: ImageBitmap | null,
	): Promise<Blob>
	readonly navigator: Pick<Navigator, 'share' | 'canShare'>
	download(file: File): void
}

/**
 * A copy of the face for the share image. `data-share` makes the stylesheet
 * draw the full name and phone number as solid bars, leave out the stamp and
 * keep the cover's area empty. The same is also done to the copy's markup,
 * so the personal details and the stamp never reach the image even if a style
 * is lost on the way: the details are blanked, the stamp removed and the
 * cover's source dropped (the cover is drawn under the copy instead).
 */
export function maskedClone(face: HTMLElement): HTMLElement {
	const clone = face.cloneNode(true) as HTMLElement
	clone.setAttribute('data-share', '')
	clone.removeAttribute('id')
	for (const el of clone.querySelectorAll('[id]')) el.removeAttribute('id')
	for (const dd of clone.querySelectorAll('[data-personal] dd')) {
		dd.textContent = ' '
	}
	for (const stamp of clone.querySelectorAll('admission-stamp')) stamp.remove()
	for (const img of clone.querySelectorAll('img')) {
		img.removeAttribute('src')
		img.removeAttribute('srcset')
	}
	return clone
}

/**
 * Makes the share image of a virtual ticket and hands it to the device: the
 * share sheet as a PNG file where the browser can share files, a download
 * otherwise. The live face is never changed; the image is drawn from a
 * masked copy (see {@link maskedClone}). Without the cover (no connection, an
 * event without one), the image is made without it.
 */
export class ShareImage {
	constructor(private readonly env: ShareImageEnv = browserEnv()) {}

	public async share(
		face: HTMLElement,
		coverUrl: string,
	): Promise<ShareOutcome> {
		const cover = coverUrl ? await this.env.fetchCover(coverUrl) : null
		try {
			const blob = await this.env.render(maskedClone(face), face, cover)
			return await this.handOff(
				new File([blob], SHARE_FILE_NAME, { type: 'image/png' }),
			)
		} finally {
			cover?.close()
		}
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
		fetchCover,
		render: renderShareImage,
		navigator,
		download,
	}
}

async function fetchCover(url: string): Promise<ImageBitmap | null> {
	try {
		const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
		if (!res.ok) return null
		return await createImageBitmap(await res.blob())
	} catch {
		return null
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

/** Device pixels per CSS pixel of the image: sharp on phones, bounded in size. */
function imageScale(): number {
	return Math.min(Math.max(window.devicePixelRatio || 1, 2), 3)
}

/**
 * Draw the masked copy into a PNG.
 *
 * 1. Mount the copy off screen inside a `virtual-ticket` element, so the
 *    face's scoped stylesheet applies, and inline every computed style: an
 *    SVG image cannot reach the page's stylesheets.
 * 2. Serialise it into an SVG `foreignObject` image.
 * 3. On the canvas, draw the cover bitmap into the cover's rectangle of the
 *    live face (cropped as `object-fit: cover` crops it), then the SVG image
 *    over it. The cover is drawn directly, never as an image nested in the
 *    SVG: WebKit leaves nested images out of the first draw.
 */
export async function renderShareImage(
	clone: HTMLElement,
	face: HTMLElement,
	cover: ImageBitmap | null,
): Promise<Blob> {
	const doc = face.ownerDocument
	const { width, height } = face.getBoundingClientRect()
	const host = doc.createElement('virtual-ticket')
	host.setAttribute('aria-hidden', 'true')
	host.inert = true
	host.style.cssText = `position:fixed;inset-block-start:0;inset-inline-start:-100000px;inline-size:${width}px;pointer-events:none`
	host.append(clone)
	doc.body.append(host)
	try {
		inlineStyles(clone)
	} finally {
		host.remove()
	}

	// Scale with a CSS transform inside the foreignObject, not with the SVG's
	// viewBox: WebKit does not scale foreignObject content by the viewBox and
	// draws the face at 1x in the corner.
	const scale = imageScale()
	const w = Math.round(width * scale)
	const h = Math.round(height * scale)
	const frame = doc.createElement('div')
	frame.setAttribute(
		'style',
		`inline-size:${width}px;block-size:${height}px;transform:scale(${scale});transform-origin:0 0`,
	)
	frame.append(clone)
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
	const radius = Number.parseFloat(getComputedStyle(face).borderTopLeftRadius)
	if (radius > 0 && typeof ctx.roundRect === 'function') {
		ctx.beginPath()
		ctx.roundRect(0, 0, width, height, radius)
		ctx.clip()
	}
	const coverArea = face.querySelector('.virtual-ticket-cover')
	if (cover && coverArea) {
		const faceBox = face.getBoundingClientRect()
		const box = coverArea.getBoundingClientRect()
		drawCovering(
			ctx,
			cover,
			box.left - faceBox.left,
			box.top - faceBox.top,
			box.width,
			box.height,
		)
	}
	ctx.setTransform(1, 0, 0, 1, 0, 0)
	ctx.drawImage(image, 0, 0)

	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
			'image/png',
		)
	})
}

/** Draw `bitmap` into the rectangle, cropped as `object-fit: cover` crops it. */
function drawCovering(
	ctx: CanvasRenderingContext2D,
	bitmap: ImageBitmap,
	x: number,
	y: number,
	width: number,
	height: number,
): void {
	const ratio = Math.max(width / bitmap.width, height / bitmap.height)
	const sw = width / ratio
	const sh = height / ratio
	ctx.drawImage(
		bitmap,
		(bitmap.width - sw) / 2,
		(bitmap.height - sh) / 2,
		sw,
		sh,
		x,
		y,
		width,
		height,
	)
}

/**
 * Copy every computed property onto each element's `style` attribute. Every
 * style is read before any is written: writing the face's own `style` first
 * would drop its `--artist-hue`, and the colours of everything inside it,
 * computed from that property, would be lost.
 */
function inlineStyles(root: HTMLElement): void {
	const elements = [root, ...root.querySelectorAll<HTMLElement>('*')]
	const styles = elements.map((el) => {
		const computed = getComputedStyle(el)
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
}
