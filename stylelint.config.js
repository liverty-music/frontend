/** @type {import('stylelint').Config} */
export default {
	extends: ['stylelint-config-standard', 'stylelint-config-clean-order'],
	plugins: ['stylelint-use-logical', './stylelint-plugin-cube-css/index.js'],
	rules: {
		'import-notation': null,

		'at-rule-no-unknown': [
			true,
			{
				ignoreAtRules: [
					'theme',
					'apply',
					'layer',
					'container',
					'starting-style',
					'property',
					'scope',
				],
			},
		],

		'function-no-unknown': [
			true,
			{
				ignoreFunctions: ['oklch', 'theme'],
			},
		],

		'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],

		'color-no-hex': true,

		// Enforce CSS Logical Properties over physical properties.
		// Autofix-capable: `stylelint --fix` converts physical → logical automatically.
		'csstools/use-logical': [
			'always',
			{
				except: [
					// Images, videos, and canvas elements have physically fixed aspect ratios.
					// Their dimensions are intrinsic to the media, not to the writing direction,
					// so physical width/height is appropriate here.
					'width',
					'height',
					'max-width',
					'max-height',
				],
			},
		],

		'property-disallowed-list': [
			// z-index is not a logical/physical property concern — it's banned to enforce
			// a design-token-based stacking context strategy instead of arbitrary values.
			'z-index',
		],

		// Legacy layout values that bypass writing-mode awareness.
		// Use `float: inline-start`/`inline-end`, `clear: inline-start`/`inline-end`,
		// and `text-align: start`/`end` instead.
		'declaration-property-value-disallowed-list': {
			float: ['left', 'right'],
			clear: ['left', 'right'],
			'text-align': ['left', 'right'],
		},

		// Enforce Container Queries over viewport Media Queries.
		// Components should respond to their container width, not the viewport.
		'media-feature-name-disallowed-list': ['width', 'min-width', 'max-width'],

		'declaration-no-important': true,

		'selector-max-id': 0,
		'selector-max-specificity': '0,4,0',
		'selector-max-compound-selectors': 4,

		'number-max-precision': 4,

		// CUBE CSS methodology enforcement.
		// Set as warnings until existing CSS files are migrated to CUBE CSS structure.
		// Promote to errors (remove severity override) as files are migrated.
		'cube/require-layer': [true, { severity: 'warning' }],
		'cube/layer-order': [true, { severity: 'warning' }],
		'cube/exception-data-attr': [true, { severity: 'warning' }],
		'cube/no-visual-in-composition': [true, { severity: 'warning' }],
		'cube/utility-single-property': [true, { severity: 'warning' }],
		'cube/block-require-scope': [true, { severity: 'warning' }],
		'cube/require-token-variables': [true, { severity: 'warning' }],
		'cube/block-max-lines': [true, { severity: 'warning' }],
		'cube/one-block-per-file': [true, { severity: 'warning' }],
		'cube/prefer-where-in-reset': [true, { severity: 'warning' }],
		'cube/data-attr-naming': [true, { severity: 'warning' }],
		'cube/prefer-vi-over-vw': [true, { severity: 'warning' }],
		'cube/require-container-name': [true, { severity: 'warning' }],
		'cube/prefer-color-mix': [true, { severity: 'warning' }],
	},
}
