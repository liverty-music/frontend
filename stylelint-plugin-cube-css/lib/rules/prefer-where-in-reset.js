import stylelint from 'stylelint';
import { getLayerContext } from '../utils/get-layer-context.js';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/prefer-where-in-reset';

const messages = ruleMessages(ruleName, {
	rejected: (selector) =>
		`Selector "${selector}" in reset/global layer should be wrapped in :where() for zero specificity.`,
});

const meta = {
	url: 'https://cube.fyi/reset.html',
	fixable: false,
};

const EXEMPT_SELECTORS = new Set([':root', 'body', 'html', '*']);
const TARGET_LAYERS = new Set(['reset', 'global']);

/**
 * Check if a selector is wrapped in :where() at the top level.
 * Accepts selectors like ":where(.foo)" or ":where(h1, h2, h3)".
 */
function isWrappedInWhere(selector) {
	const trimmed = selector.trim();

	return trimmed.startsWith(':where(') && trimmed.endsWith(')');
}

/**
 * Check if a selector is exempt from the :where() requirement.
 */
function isExempt(selector) {
	const trimmed = selector.trim();

	return EXEMPT_SELECTORS.has(trimmed);
}

/** @type {import('stylelint').Rule} */
const ruleFunction = (primary) => {
	return (root, result) => {
		const validOptions = validateOptions(result, ruleName, {
			actual: primary,
			possible: [true],
		});

		if (!validOptions) return;

		root.walkRules((ruleNode) => {
			const layer = getLayerContext(ruleNode);

			if (!TARGET_LAYERS.has(layer)) return;

			// Check each selector in a selector list
			const selectors = ruleNode.selectors;

			for (const selector of selectors) {
				if (isExempt(selector)) continue;

				if (!isWrappedInWhere(selector)) {
					report({
						message: messages.rejected(selector),
						node: ruleNode,
						result,
						ruleName,
						severity: 'warning',
					});
				}
			}
		});
	};
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;
ruleFunction.meta = meta;

export default createPlugin(ruleName, ruleFunction);
