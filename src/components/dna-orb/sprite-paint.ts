// Pure layout and painting of a bubble, shared by the canvas (direct draws and
// main-thread sprites) and the sprite worker. No Aurelia or DOM import: the
// worker loads this module too.

/** A 2D context on a page canvas or on an OffscreenCanvas. */
export type Paint2D =
	| CanvasRenderingContext2D
	| OffscreenCanvasRenderingContext2D

// Font size labels are measured at before scaling to the size tried.
export const LABEL_REF_SIZE = 100

/** The canvas font of a bubble label at `size` px. */
export function labelFont(size: number): string {
	return `bold ${size}px system-ui, sans-serif`
}

/** How a bubble label is drawn: its font, its wrapped lines and line spacing. */
export interface LabelLayout {
	font: string
	lines: string[]
	lineHeight: number
}

/**
 * Lay out a bubble's artist name: wrap it to 1.6× the radius, shrinking the
 * font by 0.5 px from `radius * 0.38` (min 10 px) until every line fits and
 * there are at most 3 lines; then truncate to 3 lines.
 *
 * @param measure - rendered width of `text` in `font` (e.g. ctx.measureText)
 */
export function computeLabelLayout(
	name: string,
	radius: number,
	measure: (text: string, font: string) => number,
): LabelLayout {
	const usableWidth = radius * 1.6
	const minFont = 10
	const maxLines = 3

	// The sizes the shrink loop steps through: from `radius * 0.38` (at least
	// the floor) down by 0.5 px, ending at the first size at or below the
	// floor, which is used whether or not the label fits. Built by repeated
	// subtraction so every size is the exact float the loop would try.
	const sizes: number[] = []
	for (let size = Math.max(minFont, radius * 0.38); ; size -= 0.5) {
		sizes.push(size)
		if (size <= minFont) break
	}

	// Every string is measured once, at one reference size, and scaled to the
	// size being tried: text width grows in proportion to the font size, and
	// switching the canvas font for each size was the costly part (561 ms of
	// measureText for a guest's 30 labels at 4x CPU throttling).
	const refWidths = new Map<string, number>()
	const refWidth = (text: string): number => {
		let w = refWidths.get(text)
		if (w === undefined) {
			w = measure(text, labelFont(LABEL_REF_SIZE))
			refWidths.set(text, w)
		}
		return w
	}
	const layoutAt = (fontSize: number) => {
		const scale = fontSize / LABEL_REF_SIZE
		const width = (t: string) => refWidth(t) * scale
		const lines = wrapText(name, usableWidth, width)
		const fits =
			lines.length <= maxLines &&
			lines.every((line) => width(line) <= usableWidth)
		return { font: labelFont(fontSize), lines, fits }
	}

	// The largest size that fits, by binary search over the steps instead of
	// trying them one by one. Text width grows with the font size, so "fits"
	// holds from some step on and the search lands on the step the one-by-one
	// loop would stop at (checked by the parity test). The last step is the
	// floor.
	let lo = 0
	let hi = sizes.length - 1
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (layoutAt(sizes[mid]).fits) hi = mid
		else lo = mid + 1
	}
	const fontSize = sizes[lo]
	let { font, lines } = layoutAt(fontSize)

	// Truncate to maxLines if still exceeded after font floor
	if (lines.length > maxLines) {
		lines = lines.slice(0, maxLines)
	}

	return { font, lines, lineHeight: fontSize * 1.25 }
}

/**
 * Wrap text to fit within maxWidth, supporting both space-delimited
 * and character-boundary wrapping for long words.
 *
 * @param measureFn - returns the rendered width of a string (e.g. ctx.measureText(t).width)
 */
export function wrapText(
	text: string,
	maxWidth: number,
	measureFn: (text: string) => number,
): string[] {
	if (!text) return [text]

	// Split by whitespace first
	const words = text.split(/\s+/)

	const lines: string[] = []
	let current = ''

	for (let w = 0; w < words.length; w++) {
		const word = words[w]
		const separator = current ? ' ' : ''
		const trial = current + separator + word

		if (measureFn(trial) <= maxWidth) {
			current = trial
		} else {
			// Current line is full — push it if non-empty
			if (current) lines.push(current)

			// If this single word exceeds maxWidth, break by character
			if (measureFn(word) > maxWidth) {
				let charLine = ''
				for (const ch of word) {
					const charTrial = charLine + ch
					if (charLine && measureFn(charTrial) > maxWidth) {
						lines.push(charLine)
						charLine = ch
					} else {
						charLine = charTrial
					}
				}
				current = charLine
			} else {
				current = word
			}
		}
	}
	if (current) lines.push(current)

	// Anti-orphan: if the last line has 1-2 characters, merge back from previous line
	if (lines.length >= 2) {
		const lastLine = lines[lines.length - 1]
		const lastCharCount = [...lastLine].length
		if (lastCharCount <= 2) {
			const prev = lines[lines.length - 2]
			const prevChars = [...prev]
			// Move enough characters from prev to make last line >= 3 chars
			const moveCount = Math.min(3 - lastCharCount, prevChars.length - 1)
			if (moveCount > 0) {
				lines[lines.length - 2] = prevChars
					.slice(0, prevChars.length - moveCount)
					.join('')
				lines[lines.length - 1] =
					prevChars.slice(prevChars.length - moveCount).join('') + lastLine
			}
		}
	}

	return lines.length > 0 ? lines : [text]
}

/**
 * An artist bubble's body at (`x`, `y`) with radius `r`: the per-artist
 * radial gradient and the soft rim. `shadowBlur` blooms the rim stroke
 * outward, the way a real soap bubble has a glowing, blurry edge rather than a
 * hard line.
 */
export function paintBubbleBody(
	ctx: Paint2D,
	x: number,
	y: number,
	r: number,
	hue: number,
): void {
	const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r)
	grad.addColorStop(0, `hsla(${hue}, 60%, 75%, 0.9)`)
	grad.addColorStop(0.7, `hsla(${hue}, 50%, 55%, 0.8)`)
	grad.addColorStop(1, `hsla(${(hue + 20) % 360}, 40%, 40%, 0.6)`)
	ctx.fillStyle = grad
	ctx.beginPath()
	ctx.arc(x, y, r, 0, Math.PI * 2)
	ctx.fill()
	paintRim(
		ctx,
		x,
		y,
		r,
		'rgba(255, 255, 255, 0.35)',
		'rgba(255, 255, 255, 0.06)',
	)
}

/** A ghost placeholder's body: a translucent violet gradient and rim. */
export function paintGhostBody(
	ctx: Paint2D,
	x: number,
	y: number,
	r: number,
): void {
	const grad = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, 0, x, y, r)
	grad.addColorStop(0, 'hsla(260, 40%, 65%, 0.6)')
	grad.addColorStop(0.7, 'hsla(250, 30%, 45%, 0.4)')
	grad.addColorStop(1, 'hsla(240, 20%, 30%, 0.2)')
	ctx.fillStyle = grad
	ctx.beginPath()
	ctx.arc(x, y, r, 0, Math.PI * 2)
	ctx.fill()
	paintRim(
		ctx,
		x,
		y,
		r,
		'rgba(180, 160, 255, 0.25)',
		'rgba(180, 160, 255, 0.05)',
	)
}

function paintRim(
	ctx: Paint2D,
	x: number,
	y: number,
	r: number,
	shadowColor: string,
	strokeColor: string,
): void {
	ctx.save()
	ctx.shadowBlur = r * 0.35
	ctx.shadowColor = shadowColor
	ctx.strokeStyle = strokeColor
	ctx.lineWidth = 2
	ctx.beginPath()
	ctx.arc(x, y, r, 0, Math.PI * 2)
	ctx.stroke()
	ctx.restore()
}

/**
 * A bubble's label, laid out for its full `radius`, centered on (`cx`, `cy`)
 * in the context's current transform.
 */
export function paintLabel(
	ctx: Paint2D,
	layout: LabelLayout,
	radius: number,
	cx: number,
	cy: number,
): void {
	ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.font = layout.font
	const { lines, lineHeight } = layout
	const usableWidth = radius * 1.6
	for (let i = 0; i < lines.length; i++) {
		const offsetY = lineHeight * (i - (lines.length - 1) / 2)
		ctx.fillText(lines[i], cx, cy + offsetY, usableWidth)
	}
}

// -- Sprites -------------------------------------------------------------------

/** What a sprite shows: an artist body, a ghost body, or an artist name. */
export type SpriteKind = 'body' | 'ghost' | 'label'

/** One sprite to paint, sent from the canvas to whoever paints it. */
export interface SpriteRequest {
	key: string
	kind: SpriteKind
	/** The artist name (labels only). */
	name: string
	/** The bubble's full radius in CSS px. */
	radius: number
	/** The artist hue (artist bodies only). */
	hue: number
	/** Device pixels per CSS px the sprite is painted at. */
	dpr: number
	/**
	 * The cache generation the request belongs to. A result from an older
	 * generation (the cache was cleared meanwhile) is discarded.
	 */
	gen: number
}

/**
 * Half the side of a sprite in CSS px. A body leaves room for the rim's blur
 * around the circle; a label fits inside the circle.
 */
export function spriteHalf(kind: SpriteKind, radius: number): number {
	return kind === 'label' ? radius : radius * 1.6
}

/** The cache key of a sprite: its kind, look and full radius. */
export function spriteKey(
	kind: SpriteKind,
	radius: number,
	nameOrHue: string | number = '',
): string {
	return `${kind}|${radius}|${nameOrHue}`
}

/**
 * Paint `req` into `ctx`, a context on a square canvas of
 * `ceil(2 * spriteHalf * dpr)` device pixels, centered. `measure` gives the
 * width of a text in a font, for the label layout.
 */
export function paintSprite(
	ctx: Paint2D,
	req: SpriteRequest,
	measure: (text: string, font: string) => number,
): void {
	const half = spriteHalf(req.kind, req.radius)
	ctx.setTransform(req.dpr, 0, 0, req.dpr, half * req.dpr, half * req.dpr)
	switch (req.kind) {
		case 'body':
			paintBubbleBody(ctx, 0, 0, req.radius, req.hue)
			break
		case 'ghost':
			paintGhostBody(ctx, 0, 0, req.radius)
			break
		case 'label':
			paintLabel(
				ctx,
				computeLabelLayout(req.name, req.radius, measure),
				req.radius,
				0,
				0,
			)
			break
	}
}

/** The side, in device pixels, of the canvas a sprite is painted into. */
export function spritePixels(req: SpriteRequest): number {
	return Math.ceil(spriteHalf(req.kind, req.radius) * 2 * req.dpr)
}

/**
 * A measure function over `ctx` that switches the context's font only when it
 * changes.
 */
export function measureWith(
	ctx: Paint2D,
): (text: string, font: string) => number {
	let current = ''
	return (text, font) => {
		if (current !== font) {
			ctx.font = font
			current = font
		}
		return ctx.measureText(text).width
	}
}
