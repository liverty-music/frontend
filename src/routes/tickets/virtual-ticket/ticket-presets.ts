/**
 * The design presets of a virtual ticket, one per kind of concert. A preset
 * decides how the art is graded and foiled (here) and how the ticket is set
 * and coloured (ticket-presets.css, by the same name).
 */
export type TicketPreset =
	| 'default'
	| 'rock'
	| 'pop'
	| 'jazz'
	| 'classic'
	| 'electronic'

/** A colour as red, green and blue in 0..1. */
type Rgb = readonly [number, number, number]

/** How the renderer draws a preset. */
export interface TicketLook {
	/**
	 * The stub's paper at its top and bottom, as 0xRRGGBB; null takes the
	 * paper colour the ticket's CSS resolves to.
	 */
	readonly paper: readonly [number, number] | null
	/** The duotone the art is graded towards: its shadows and its lights. */
	readonly shadow: Rgb
	readonly light: Rgb
	/** How far the art is graded (0 keeps the cover's own colours). */
	readonly grade: number
	/** The foil's own colour, and how much of it is rainbow instead (0-1). */
	readonly foilTint: Rgb
	readonly rainbow: number
	readonly foil: number
	/** Scan lines, film grain and glitter over the art (0 is none). */
	readonly scan: number
	readonly grain: number
	readonly sparkle: number
}

export const TICKET_LOOKS: Record<TicketPreset, TicketLook> = {
	// The cover as it is under a rainbow foil; the paper follows the performer's hue.
	default: {
		paper: null,
		shadow: [0, 0, 0],
		light: [1, 1, 1],
		grade: 0,
		foilTint: [1, 1, 1],
		rainbow: 1,
		foil: 1,
		scan: 0,
		grain: 0,
		sparkle: 1,
	},
	// A photocopied gig flyer: black and hot pink, grainy.
	rock: {
		paper: [0x0e0e10, 0x0e0e10],
		shadow: [0.03, 0.02, 0.04],
		light: [1, 0.27, 0.62],
		grade: 0.88,
		foilTint: [1, 0.3, 0.7],
		rainbow: 0.15,
		foil: 0.7,
		scan: 0,
		grain: 0.24,
		sparkle: 0.3,
	},
	// A holographic sticker: pastel paper, full rainbow, lots of glitter.
	pop: {
		paper: [0xffe9f6, 0xe4e6ff],
		shadow: [0, 0, 0],
		light: [1, 1, 1],
		grade: 0,
		foilTint: [1, 1, 1],
		rainbow: 1,
		foil: 1.3,
		scan: 0,
		grain: 0,
		sparkle: 1.7,
	},
	// A club poster on cream stock: warm brown and orange.
	jazz: {
		paper: [0xf3e3c3, 0xedd8b0],
		shadow: [0.16, 0.07, 0.03],
		light: [1, 0.78, 0.5],
		grade: 0.82,
		foilTint: [1, 0.75, 0.4],
		rainbow: 0.1,
		foil: 0.5,
		scan: 0,
		grain: 0.15,
		sparkle: 0.2,
	},
	// A gala invitation: black with gold foil.
	classic: {
		paper: [0x12100d, 0x0c0b09],
		shadow: [0.02, 0.02, 0.02],
		light: [0.95, 0.9, 0.8],
		grade: 0.9,
		foilTint: [1, 0.82, 0.45],
		rainbow: 0.05,
		foil: 1.15,
		scan: 0,
		grain: 0.05,
		sparkle: 0.8,
	},
	// A night flight: navy with cyan and magenta light, scan lines.
	electronic: {
		paper: [0x070b24, 0x0b0730],
		shadow: [0.25, 0, 0.45],
		light: [0.3, 1, 1],
		grade: 0.78,
		foilTint: [0.3, 0.9, 1],
		rainbow: 0.5,
		foil: 0.9,
		scan: 0.35,
		grain: 0.04,
		sparkle: 0.5,
	},
}
