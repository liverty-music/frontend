import stylelint from 'stylelint';
import { getLayerContext } from '../utils/get-layer-context.js';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/prefer-color-mix';

const messages = ruleMessages(ruleName, {
	rejected: (prop) =>
		`Unexpected raw color value for variant "${prop}". Use color-mix() or relative color syntax (e.g. oklch(from ...)) instead.`,
});

const meta = {
	url: 'https://github.com/liverty-music/frontend/tree/main/stylelint-plugin-cube-css/lib/rules/prefer-color-mix.md',
	fixable: false,
};

/** Variant suffixes that indicate a color is derived from a base. */
const VARIANT_SUFFIXES = [
	'-light',
	'-dark',
	'-hover',
	'-muted',
	'-alpha',
	'-subtle',
	'-vivid',
	'-dim',
	'-bright',
];

/**
 * Check if a property name looks like a color variant.
 */
function isVariantProperty(prop) {
	return VARIANT_SUFFIXES.some((suffix) => prop.endsWith(suffix));
}

/**
 * Check whether the value uses color-mix().
 */
function usesColorMix(value) {
	return value.includes('color-mix(');
}

/**
 * Check whether the value uses relative color syntax (e.g. oklch(from ...)).
 */
function usesRelativeColor(value) {
	// Match color functions with "from" keyword: oklch(from ...), hsl(from ...), etc.
	return /\b(?:oklch|oklab|lch|lab|hsl|hwb|rgb)\s*\(\s*from\b/i.test(value);
}

const ruleFunction = (primary) => {
	return (root, result) => {
		const validOptions = validateOptions(result, ruleName, {
			actual: primary,
			possible: [true],
		});

		if (!validOptions) return;

		root.walkDecls(/^--color-/, (decl) => {
			// Only applies inside @layer global.
			const layer = getLayerContext(decl);

			if (layer !== 'global') return;

			const value = decl.value.trim();
			const prop = decl.prop;

			// If it already uses color-mix() or relative color syntax, it's fine.
			if (usesColorMix(value) || usesRelativeColor(value)) {
				return;
			}

			// Only warn for variant properties (base definitions are OK).
			if (!isVariantProperty(prop)) {
				return;
			}

			report({
				message: messages.rejected(prop),
				node: decl,
				result,
				ruleName,
				severity: 'warning',
			});
		});
	};
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;
ruleFunction.meta = meta;

export default createPlugin(ruleName, ruleFunction);
