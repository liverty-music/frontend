import stylelint from 'stylelint';
import { getLayerContext } from '../utils/get-layer-context.js';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/utility-single-property';

const DEFAULT_MAX = 2;

const messages = ruleMessages(ruleName, {
	rejected: (selector, count, max) =>
		`Expected at most ${max} declaration(s) in utility selector "${selector}", but found ${count}.`,
});

const meta = {
	url: 'https://cube.fyi/utility.html',
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
				possible: { max: [(v) => Number.isInteger(v) && v > 0] },
				optional: true,
			},
		);

		if (!validOptions) return;

		const max = secondaryOptions?.max ?? DEFAULT_MAX;

		root.walkRules((ruleNode) => {
			const layer = getLayerContext(ruleNode);

			if (layer !== 'utility') return;

			// Count direct declaration children only
			const declCount = ruleNode.nodes.filter(
				(child) => child.type === 'decl',
			).length;

			if (declCount > max) {
				report({
					message: messages.rejected(ruleNode.selector, declCount, max),
					node: ruleNode,
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
