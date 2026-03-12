import stylelint from 'stylelint';
import { getLayerContext } from '../utils/get-layer-context.js';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/data-attr-naming';

const messages = ruleMessages(ruleName, {
	rejected: (attr) =>
		`Unexpected data attribute "${attr}" in exception layer. Only data-state, data-variant, and data-theme are allowed.`,
});

const meta = {
	url: 'https://cube.fyi/exception.html',
	fixable: false,
};

const DEFAULT_ALLOWED = new Set(['data-state', 'data-variant', 'data-theme']);

// Match [data-*] attribute selectors, with or without value
const DATA_ATTR_REGEX = /\[(data-[\w-]+)(?:[~|^$*]?=)?/g;

/** @type {import('stylelint').Rule} */
const ruleFunction = (primary, secondaryOptions) => {
	return (root, result) => {
		const validOptions = validateOptions(
			result,
			ruleName,
			{ actual: primary, possible: [true] },
			{
				actual: secondaryOptions,
				possible: {
					additionalAttributes: [(v) => typeof v === 'string'],
				},
				optional: true,
			},
		);

		if (!validOptions) return;

		// Build the allowed attributes set
		let allowed = DEFAULT_ALLOWED;

		if (secondaryOptions?.additionalAttributes) {
			allowed = new Set([
				...DEFAULT_ALLOWED,
				...secondaryOptions.additionalAttributes,
			]);
		}

		root.walkRules((ruleNode) => {
			const layer = getLayerContext(ruleNode);

			if (layer !== 'exception') return;

			const selector = ruleNode.selector;
			let match;

			// Reset regex lastIndex for each selector
			DATA_ATTR_REGEX.lastIndex = 0;

			while ((match = DATA_ATTR_REGEX.exec(selector)) !== null) {
				const attrName = match[1];

				if (!allowed.has(attrName)) {
					report({
						message: messages.rejected(attrName),
						node: ruleNode,
						result,
						ruleName,
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
