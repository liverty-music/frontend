import stylelint from 'stylelint';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/require-layer';

const messages = ruleMessages(ruleName, {
	rejected: (type) =>
		`Unexpected ${type} outside of an @layer block. All styles must be inside a CUBE CSS layer.`,
});

const meta = {
	url: 'https://github.com/liverty-music/frontend/tree/main/stylelint-plugin-cube-css/lib/rules/require-layer.md',
	fixable: false,
};

/** At-rules that are allowed at the top level (outside @layer). */
const ALLOWED_TOP_LEVEL_ATRULES = new Set(['font-face', 'property']);

/** At-rules whose child rules should not be checked (they are internal). */
const INTERNAL_ATRULE_PARENTS = new Set(['keyframes', 'font-face', 'property']);

/**
 * Check whether a PostCSS node has an @layer ancestor.
 */
function isInsideLayer(node) {
	let current = node.parent;

	while (current) {
		if (current.type === 'atrule' && current.name === 'layer') {
			return true;
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

		// Check style rules (selectors) outside @layer
		root.walkRules((rule) => {
			// Skip rules that are children of at-rules with internal structure
			// (e.g., `from`/`to` inside @keyframes, rules inside @font-face/@property)
			let parent = rule.parent;

			while (parent && parent.type !== 'root') {
				if (
					parent.type === 'atrule' &&
					INTERNAL_ATRULE_PARENTS.has(parent.name)
				) {
					return;
				}

				parent = parent.parent;
			}

			if (!isInsideLayer(rule)) {
				report({
					message: messages.rejected('style rule'),
					node: rule,
					result,
					ruleName,
				});
			}
		});

		// Check @keyframes outside @layer
		root.walkAtRules('keyframes', (atRule) => {
			if (!isInsideLayer(atRule)) {
				report({
					message: messages.rejected('@keyframes'),
					node: atRule,
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
