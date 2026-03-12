import stylelint from 'stylelint';
import { getLayerContext } from '../utils/get-layer-context.js';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/exception-data-attr';

const messages = ruleMessages(ruleName, {
	rejected: (selector) =>
		`Expected a [data-*] attribute selector in exception layer. Found "${selector}" without one.`,
});

const meta = {
	url: 'https://github.com/liverty-music/frontend/tree/main/stylelint-plugin-cube-css/lib/rules/exception-data-attr.md',
	fixable: false,
};

/** Pattern to detect [data-...] attribute selectors. */
const DATA_ATTR_PATTERN = /\[data-/;

const ruleFunction = (primary) => {
	return (root, result) => {
		const validOptions = validateOptions(result, ruleName, {
			actual: primary,
			possible: [true],
		});

		if (!validOptions) return;

		root.walkRules((rule) => {
			const layerName = getLayerContext(rule);

			// Only enforce in the exception layer
			if (layerName !== 'exception') return;

			if (!DATA_ATTR_PATTERN.test(rule.selector)) {
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
