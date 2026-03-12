import stylelint from 'stylelint';
import { getLayerContext } from '../utils/get-layer-context.js';
import {
	containsVar,
	containsCalc,
	isStructuralValue,
} from '../utils/is-var-function.js';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/require-token-variables';

const messages = ruleMessages(ruleName, {
	rejected: (prop) =>
		`Property '${prop}' must use a design token via var().`,
	rejectedCalc: (prop) =>
		`Property '${prop}': calc() must reference at least one design token via var().`,
});

const meta = {
	url: 'https://github.com/liverty-music/frontend/tree/main/stylelint-plugin-cube-css/lib/rules/require-token-variables.md',
	fixable: false,
};

const DEFAULT_PROPERTIES = [
	'padding',
	'padding-block',
	'padding-block-start',
	'padding-block-end',
	'padding-inline',
	'padding-inline-start',
	'padding-inline-end',
	'margin',
	'margin-block',
	'margin-block-start',
	'margin-block-end',
	'margin-inline',
	'margin-inline-start',
	'margin-inline-end',
	'gap',
	'row-gap',
	'column-gap',
	'color',
	'background',
	'background-color',
	'border-color',
	'outline-color',
	'font-size',
	'font-family',
	'line-height',
	'border-radius',
	'box-shadow',
	'transition-duration',
	'animation-duration',
];

const DEFAULT_IGNORE_LAYERS = ['reset', 'global'];

const ruleFunction = (primary, secondaryOptions) => {
	return (root, result) => {
		const validOptions = validateOptions(
			result,
			ruleName,
			{
				actual: primary,
				possible: [true],
			},
			{
				actual: secondaryOptions,
				possible: {
					properties: [(v) => typeof v === 'string'],
					ignoreLayers: [(v) => typeof v === 'string'],
				},
				optional: true,
			},
		);

		if (!validOptions) return;

		const properties = new Set(
			secondaryOptions?.properties ?? DEFAULT_PROPERTIES,
		);
		const ignoreLayers = new Set(
			secondaryOptions?.ignoreLayers ?? DEFAULT_IGNORE_LAYERS,
		);

		root.walkDecls((decl) => {
			const layer = getLayerContext(decl);

			// Skip declarations not in any layer, or in ignored layers
			if (!layer || ignoreLayers.has(layer)) return;

			const prop = decl.prop.toLowerCase();

			// Only check enforced properties
			if (!properties.has(prop)) return;

			const value = decl.value;

			// Structural values are always allowed
			if (isStructuralValue(value)) return;

			// Values using var() are allowed
			if (containsVar(value)) return;

			// calc() without var() is an error
			if (containsCalc(value)) {
				report({
					message: messages.rejectedCalc(prop),
					node: decl,
					result,
					ruleName,
				});
				return;
			}

			// Raw value without var() is an error
			report({
				message: messages.rejected(prop),
				node: decl,
				result,
				ruleName,
			});
		});
	};
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;
ruleFunction.meta = meta;

export default createPlugin(ruleName, ruleFunction);
