/**
 * Properties classified as "visual treatment" — disallowed in the composition layer.
 * Composition should only contain structural/layout properties.
 */
export const VISUAL_PROPERTIES = new Set([
	// Color
	'color',
	'background',
	'background-color',
	'background-image',
	'background-gradient',
	'border-color',
	'outline-color',
	// Typography (decorative)
	'font-style',
	'font-weight',
	'text-decoration',
	'text-decoration-line',
	'text-decoration-style',
	'text-decoration-color',
	'text-transform',
	'letter-spacing',
	// Decorative
	'box-shadow',
	'text-shadow',
	'border-radius',
	'opacity',
	'filter',
	'backdrop-filter',
	// Transitions & Animations
	'transition',
	'transition-property',
	'transition-duration',
	'transition-timing-function',
	'transition-delay',
	'animation',
	'animation-name',
	'animation-duration',
	'animation-timing-function',
	'animation-delay',
]);
