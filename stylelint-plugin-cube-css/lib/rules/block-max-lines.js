import stylelint from 'stylelint';
import { getLayerContext } from '../utils/get-layer-context.js';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/block-max-lines';

const messages = ruleMessages(ruleName, {
	rejected: (lines, max) =>
		`@scope block is ${lines} lines, exceeding the maximum of ${max} lines. Split into smaller blocks.`,
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

		root.walkAtRules('scope', (scopeNode) => {
			const layer = getLayerContext(scopeNode);

			// Only check @scope blocks inside @layer block
			if (layer !== 'block') return;

			const startLine = scopeNode.source.start.line;
			const endLine = scopeNode.source.end.line;
			const lines = endLine - startLine + 1;

			if (lines > max) {
				report({
					message: messages.rejected(lines, max),
					node: scopeNode,
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
