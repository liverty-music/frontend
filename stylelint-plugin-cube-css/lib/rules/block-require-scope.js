import stylelint from 'stylelint';
import { getLayerContext } from '../utils/get-layer-context.js';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/block-require-scope';

const messages = ruleMessages(ruleName, {
	rejected: (selector) =>
		`Style rule "${selector}" inside @layer block must be wrapped in @scope.`,
});

const meta = {
	url: 'https://github.com/liverty-music/frontend/tree/main/stylelint-plugin-cube-css/lib/rules/block-require-scope.md',
	fixable: false,
};

/**
 * Check whether a node has a @scope ancestor between itself and the @layer.
 * Walks from node.parent upward, returning true if @scope is found before @layer.
 */
function hasScopeAncestor(node) {
	let current = node.parent;

	while (current) {
		if (current.type === 'atrule') {
			if (current.name === 'scope') {
				return true;
			}

			// Stop searching once we reach the @layer boundary
			if (current.name === 'layer') {
				return false;
			}
		}

		current = current.parent;
	}

	return false;
}

const ruleFunction = (primary) => {
	return (root, result) => {
		const validOptions = validateOptions(result, ruleName, {
			actual: primary,
			possible: [true],
		});

		if (!validOptions) return;

		root.walkRules((rule) => {
			const layer = getLayerContext(rule);

			// Only enforce within the block layer
			if (layer !== 'block') return;

			if (!hasScopeAncestor(rule)) {
				report({
					message: messages.rejected(rule.selector),
					node: rule,
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
