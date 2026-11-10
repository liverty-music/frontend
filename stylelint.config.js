const PROPERTY_DISALLOWED = [
	// z-index is not a logical/physical property concern — it's banned to enforce
	// a design-token-based stacking context strategy instead of arbitrary values.
	'z-index',
]

// Legacy layout values that bypass writing-mode awareness.
// Use `float: inline-start`/`inline-end`, `clear: inline-start`/`inline-end`,
// and `text-align: start`/`end` instead.
const VALUE_DISALLOWED = {
	float: ['left', 'right'],
	clear: ['left', 'right'],
	'text-align': ['left', 'right'],
}

/** What a component's own stylesheet may read, by what it styles. */
const LOCAL_TOKEN = '/^--_/'
const COLOUR_TOKENS = [
	'/^--md-sys-color-/',
	// A state layer is a colour-mix() over a state opacity.
	'/^--md-sys-state-/',
	'/^--color-brand-/',
	'/^--color-stage-/',
	'--color-error',
	'--color-warning',
	'--color-success',
	// White has no Material 3 role: text on a coloured fill, a translucent veil.
	'--color-white',
	LOCAL_TOKEN,
]

/** @type {import('stylelint').Config} */
export default {
	extends: ['stylelint-config-standard', 'stylelint-config-clean-order'],
	plugins: ['./stylelint-plugin-cube-css/index.js'],
	reportDescriptionlessDisables: true,
	reportNeedlessDisables: true,
	reportUnscopedDisables: true,
	rules: {
		'import-notation': null,

		// Allow token names like --step--1 (negative step scale).
		'custom-property-pattern': null,

		'function-no-unknown': [
			true,
			{
				ignoreFunctions: ['oklch'],
			},
		],

		'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],

		'color-no-hex': true,

		// Enforce CSS Logical Properties over physical properties.
		'property-layout-mappings': [
			'flow-relative',
			{
				ignoreProperties: [
					// Images, videos, and canvas elements have physically fixed aspect ratios.
					// Their dimensions are intrinsic to the media, not to the writing direction,
					// so physical width/height is appropriate here.
					'width',
					'height',
					'max-width',
					'max-height',
					// stylelint-use-logical, which this rule replaced, accepted these too.
					// The rule objects to multi-value shorthands and axis longhands, which
					// behave the same in the horizontal writing mode every app uses.
					'padding',
					'margin',
					'inset',
					'/^overflow/',
					'/^overscroll-behavior/',
				],
			},
		],

		// A var() resolves to nothing when no stylesheet defines it. A property set
		// inline by a template is declared by a described disable in its stylesheet.
		'no-unknown-custom-properties': true,

		'property-disallowed-list': PROPERTY_DISALLOWED,

		'declaration-property-value-disallowed-list': VALUE_DISALLOWED,

		// Enforce Container Queries over viewport Media Queries.
		// Components should respond to their container width, not the viewport.
		'media-feature-name-disallowed-list': ['width', 'min-width', 'max-width'],

		'declaration-no-important': true,

		'selector-max-id': 0,
		'selector-max-specificity': '0,4,0',
		'selector-max-compound-selectors': 4,

		'number-max-precision': 4,

		// CUBE CSS methodology enforcement.
		'cube/require-layer': true,
		'cube/layer-order': true,
		'cube/exception-data-attr': true,
		'cube/no-visual-in-composition': true,
		'cube/utility-single-property': true,
		'cube/block-require-scope': true,
		'cube/require-token-variables': true,
		'cube/block-max-lines': [true, { max: 510 }],
		'cube/one-block-per-file': true,
		'cube/prefer-where-in-reset': true,
		'cube/data-attr-naming': true,
		'cube/prefer-vi-over-vw': true,
		'cube/require-container-name': true,
		'cube/prefer-color-mix': true,
	},
	overrides: [
		{
			// Console components render in their own shadow root (organizer
			// design D16): the shadow root bounds every rule, so a block needs no
			// @scope there, and `:host` is the component's root.
			files: ['organizer/ui/**/*.css'],
			rules: {
				'cube/block-require-scope': null,
			},
		},
		// A component's stylesheet cannot undo a shared layer. Margins come from a
		// composition, type from a `.md-typescale-*` class in the template, focus from
		// the global ring, and each visual value from a role token. `overrides`
		// replaces a rule's value rather than merging it, so these repeat the base
		// config's entries.
		//
		// The allowed names are the target of adopt-m3-cube-ui-foundation, whose
		// later steps move today's `--md-shape-*`, `--md-elevation-*` and fonts onto
		// them; until then those uses are recorded in stylelint-suppressions.json.
		// Admin and reception are outside that change and keep their own rules.
		{
			files: [
				'src/components/**/*.css',
				'src/routes/**/*.css',
				'shared/ui/**/*.css',
				'src/app-shell.css',
				'src/styles/button.css',
				'src/styles/text-field.css',
				'src/styles/chip.css',
				'src/styles/summary-list.css',
				'shared/styles/card.css',
				'src/styles/status-label.css',
				'src/styles/text-link.css',
				'shared/styles/icon-button.css',
				'shared/styles/menu.css',
				'organizer/!(styles)/**/*.css',
			],
			rules: {
				'property-disallowed-list': [
					...PROPERTY_DISALLOWED,
					'/^margin/',
					'/^font(-family|-size|-weight|-style)?$/',
					'line-height',
					'letter-spacing',
					'/^outline/',
				],
				'declaration-property-value-disallowed-list': {
					...VALUE_DISALLOWED,
					'/^padding/': ['0'],
					'list-style': ['none'],
				},
				'declaration-property-custom-property-allowed-list': {
					'/^(color|background(-color)?|border(-[a-z]+)*-color|fill|stroke|caret-color|accent-color)$/':
						COLOUR_TOKENS,
					'/^border(-[a-z]+)*-radius$/': ['/^--md-sys-shape-/', LOCAL_TOKEN],
					'box-shadow': ['/^--md-sys-elevation-/', '/^--glow-/', LOCAL_TOKEN],
					'/^(padding|gap|row-gap|column-gap)/': ['/^--space-/', LOCAL_TOKEN],
				},
				'declaration-property-value-allowed-list': {
					'box-shadow': ['none', '/^var\\(/'],
				},
				'cube/block-max-lines': [true, { max: 100 }],
			},
		},
		// The console's reset zeroes margins only (organizer/styles/shared.css),
		// so a console stylesheet's `padding: 0` or `list-style: none` undoes a
		// browser default rather than repeating the reset.
		{
			files: ['organizer/!(styles)/**/*.css'],
			rules: {
				'declaration-property-value-disallowed-list': VALUE_DISALLOWED,
			},
		},
		// The shared button owns its label: label-large is the role of every
		// text button, so the 126 buttons in templates carry no type class.
		{
			files: ['src/styles/button.css'],
			rules: {
				'property-disallowed-list': [
					...PROPERTY_DISALLOWED,
					'/^margin/',
					'/^outline/',
				],
			},
		},
		// A type style class sets the five font longhands, not the `font`
		// shorthand, which would reset the fan app's `palt` (m3-typescale.css).
		{
			files: ['shared/styles/m3-typescale.css'],
			rules: {
				'cube/utility-single-property': [true, { max: 5 }],
			},
		},
		// Each self-contained entry declares its own tokens.
		{
			files: ['src/**/*.css', 'shared/**/*.css'],
			referenceFiles: ['src/styles/*.css', 'shared/styles/*.css'],
		},
		{
			files: ['admin/**/*.css'],
			referenceFiles: ['admin/styles/main.css'],
		},
		{
			files: ['reception/**/*.css'],
			referenceFiles: ['reception/styles/main.css'],
		},
		{
			files: ['organizer/**/*.css'],
			referenceFiles: [
				'organizer/styles/*.css',
				'shared/styles/*.css',
				// Defines --page-inline-padding, which every screen inherits.
				'organizer/organizer-shell/organizer-shell.css',
			],
		},
	],
}
