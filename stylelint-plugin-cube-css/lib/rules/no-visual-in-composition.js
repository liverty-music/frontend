import stylelint from 'stylelint';
import { getLayerContext } from '../utils/get-layer-context.js';
import { VISUAL_PROPERTIES } from '../utils/visual-properties.js';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/no-visual-in-composition';

const messages = ruleMessages(ruleName, {
	rejected: (property) =>
		`Unexpected visual property "${property}" in composition layer. Composition should only contain structural/layout properties.`,
});

const meta = {
	url: 'https://cube.fyi/composition.html',
	fixable: false,
};

/** @type {import('stylelint').Rule} */
const ruleFunction = (primary, secondaryOptions) => {
	return (root, result) => {
		const validOptions = validateOptions(
			result,
			ruleName,
			{ actual: primary, possible: [true] },
			{
				actual: secondaryOptions,
				possible: { additionalVisualProperties: [(v) => typeof v === 'string'] },
				optional: true,
			},
		);

		if (!validOptions) return;

		// Build the effective visual properties set
		let visualProps = VISUAL_PROPERTIES;

		if (secondaryOptions?.additionalVisualProperties) {
			visualProps = new Set([
				...VISUAL_PROPERTIES,
				...secondaryOptions.additionalVisualProperties,
			]);
		}

		root.walkDecls((decl) => {
			const layer = getLayerContext(decl);

			if (layer !== 'composition') return;

			if (visualProps.has(decl.prop)) {
				report({
					message: messages.rejected(decl.prop),
					node: decl,
					result,
					ruleName,
				});
			}
		});
	};
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;
ruleFunction.meta = meta;

export default createPlugin(ruleName, ruleFunction);
