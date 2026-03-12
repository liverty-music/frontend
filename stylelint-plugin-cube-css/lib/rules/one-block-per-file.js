import stylelint from 'stylelint';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/one-block-per-file';

const messages = ruleMessages(ruleName, {
	rejected: (count) =>
		`Found ${count} @scope directives inside @layer block. Each file should contain at most one @scope directive.`,
});

const meta = {
	url: 'https://cube.fyi/block.html',
	fixable: false,
};

/** @type {import('stylelint').Rule} */
const ruleFunction = (primary) => {
	return (root, result) => {
		const validOptions = validateOptions(result, ruleName, {
			actual: primary,
			possible: [true],
		});

		if (!validOptions) return;

		const scopeNodes = [];

		root.walkAtRules('layer', (layerNode) => {
			if (layerNode.params?.trim() !== 'block') return;

			layerNode.walkAtRules('scope', (scopeNode) => {
				scopeNodes.push(scopeNode);
			});
		});

		if (scopeNodes.length > 1) {
			// Report on the second @scope node onward
			for (let i = 1; i < scopeNodes.length; i++) {
				report({
					message: messages.rejected(scopeNodes.length),
					node: scopeNodes[i],
					result,
					ruleName,
				});
			}
		}
	};
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;
ruleFunction.meta = meta;

export default createPlugin(ruleName, ruleFunction);
