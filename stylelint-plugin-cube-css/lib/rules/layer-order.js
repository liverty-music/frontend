import stylelint from 'stylelint';
import { CUBE_LAYERS, CUBE_LAYER_SET } from '../utils/get-layer-context.js';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/layer-order';

const messages = ruleMessages(ruleName, {
	rejectedOrder: (actual, expected) =>
		`Unexpected layer order. Found "${actual}" after "${expected}" but it should come before.`,
	rejectedUnknown: (name) =>
		`Unknown CUBE CSS layer "${name}". Expected one of: ${CUBE_LAYERS.join(', ')}.`,
	rejectedDeclarationOrder: (names) =>
		`Unexpected @layer declaration order "${names}". Expected order: ${CUBE_LAYERS.join(', ')}.`,
});

const meta = {
	url: 'https://github.com/liverty-music/frontend/tree/main/stylelint-plugin-cube-css/lib/rules/layer-order.md',
	fixable: false,
};

/**
 * Build an index map for quick order lookups.
 */
const LAYER_INDEX = new Map(CUBE_LAYERS.map((name, index) => [name, index]));

const ruleFunction = (primary) => {
	return (root, result) => {
		const validOptions = validateOptions(result, ruleName, {
			actual: primary,
			possible: [true],
		});

		if (!validOptions) return;

		// Track the highest layer index seen so far for block @layer order
		let highestBlockIndex = -1;
		let highestBlockName = '';

		root.walkAtRules('layer', (atRule) => {
			// Only check top-level @layer nodes; nested @layer blocks
			// should not participate in the document-level order check.
			if (atRule.parent.type !== 'root') return;

			const hasBody = atRule.nodes !== undefined;
			const params = atRule.params.trim();

			if (!hasBody) {
				// Declaration statement: @layer reset, global, composition;
				const names = params.split(',').map((n) => n.trim()).filter(Boolean);

				// Check for unknown names and relative order in a single pass.
				// Unknown names are reported but skipped for order comparison.
				let prevIndex = -1;

				for (const name of names) {
					if (!CUBE_LAYER_SET.has(name)) {
						report({
							message: messages.rejectedUnknown(name),
							node: atRule,
							result,
							ruleName,
						});

						continue;
					}

					const currentIndex = LAYER_INDEX.get(name);

					if (currentIndex < prevIndex) {
						report({
							message: messages.rejectedDeclarationOrder(params),
							node: atRule,
							result,
							ruleName,
						});

						return;
					}

					prevIndex = currentIndex;
				}
			} else {
				// Block @layer: @layer reset { ... }
				const name = params;

				if (!name) return;

				if (!CUBE_LAYER_SET.has(name)) {
					report({
						message: messages.rejectedUnknown(name),
						node: atRule,
						result,
						ruleName,
					});

					return;
				}

				const currentIndex = LAYER_INDEX.get(name);

				if (currentIndex < highestBlockIndex) {
					report({
						message: messages.rejectedOrder(name, highestBlockName),
						node: atRule,
						result,
						ruleName,
					});
				}

				if (currentIndex > highestBlockIndex) {
					highestBlockIndex = currentIndex;
					highestBlockName = name;
				}
			}
		});
	};
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;
ruleFunction.meta = meta;

export default createPlugin(ruleName, ruleFunction);
