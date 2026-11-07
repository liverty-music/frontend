import stylelint from 'stylelint';
import { getLayerContext } from '../utils/get-layer-context.js';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/block-max-lines';

const messages = ruleMessages(ruleName, {
	rejected: (lines, max) =>
		`Block is ${lines} lines, exceeding the maximum of ${max} lines. Split into smaller blocks.`,
});

const meta = {
	url: 'https://cube.fyi/block.html',
	fixable: false,
};

const DEFAULT_MAX = 80;

/** @type {import('stylelint').Rule} */
const ruleFunction = (primary, secondaryOptions) => {
	return (root, result) => {
		const validOptions = validateOptions(
			result,
			ruleName,
			{ actual: primary, possible: [true] },
			{
				actual: secondaryOptions,
				possible: { max: [(v) => typeof v === 'number' && v > 0] },
				optional: true,
			},
		);

		if (!validOptions) return;

		const max = secondaryOptions?.max ?? DEFAULT_MAX;

		const check = (node) => {
			const lines = node.source.end.line - node.source.start.line + 1;

			if (lines > max) {
				report({
					message: messages.rejected(lines, max),
					node,
					result,
					ruleName,
				});
			}
		};

		root.walkAtRules('scope', (scopeNode) => {
			// Only check @scope blocks inside @layer block
			if (getLayerContext(scopeNode) === 'block') check(scopeNode);
		});

		// A component in a shadow root needs no @scope, so its block is the layer.
		root.walkAtRules('layer', (layerNode) => {
			if (layerNode.params !== 'block' || !layerNode.nodes) return;

			let hasScope = false;

			layerNode.walkAtRules('scope', () => {
				hasScope = true;
			});

			if (!hasScope) check(layerNode);
		});
	};
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;
ruleFunction.meta = meta;

export default createPlugin(ruleName, ruleFunction);
