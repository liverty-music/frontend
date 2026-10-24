import stylelint from 'stylelint';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/no-undefined-color-token';

const messages = ruleMessages(ruleName, {
	rejected: (name) =>
		`Unexpected undefined color token "${name}". Use a --color-* token the token files define.`,
});

const meta = {
	url: 'https://github.com/liverty-music/frontend/tree/main/stylelint-plugin-cube-css/lib/rules/no-undefined-color-token.js',
	fixable: false,
};

const REFERENCE = /var\(\s*(--color-[\w-]+)/g;

/**
 * A `var(--color-*)` resolves to nothing when no token defines it, and a
 * fallback hides that, so every reference must name a token defined by the
 * token files (the `tokens` option) or by the stylesheet itself.
 *
 * @type {import('stylelint').Rule}
 */
const ruleFunction = (primary, secondaryOptions) => {
	return (root, result) => {
		const validOptions = validateOptions(
			result,
			ruleName,
			{ actual: primary, possible: [true] },
			{
				actual: secondaryOptions,
				possible: { tokens: [(v) => typeof v === 'string'] },
			},
		);

		if (!validOptions) return;

		const defined = new Set(secondaryOptions.tokens);
		root.walkDecls(/^--color-/, (decl) => defined.add(decl.prop));

		root.walkDecls((decl) => {
			for (const [, name] of decl.value.matchAll(REFERENCE)) {
				if (defined.has(name)) continue;
				report({
					message: messages.rejected(name),
					node: decl,
					word: name,
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
