import stylelint from 'stylelint';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/prefer-vi-over-vw';

/** Map from viewport-width units to their logical inline equivalents. */
const UNIT_MAP = {
	vw: 'vi',
	svw: 'svi',
	lvw: 'lvi',
	dvw: 'dvi',
};

const messages = ruleMessages(ruleName, {
	rejected: (found, suggested) =>
		`Unexpected viewport-width unit "${found}". Use logical inline unit "${suggested}" instead.`,
});

const meta = {
	url: 'https://github.com/liverty-music/frontend/tree/main/stylelint-plugin-cube-css/lib/rules/prefer-vi-over-vw.md',
	fixable: false,
};

/**
 * Match numeric values followed by vw/svw/lvw/dvw units.
 * Word boundary prevents matching substrings like "overview".
 */
const UNIT_PATTERN = /\b(\d+(?:\.\d+)?)(d?[sl]?vw)\b/g;

const ruleFunction = (primary) => {
	return (root, result) => {
		const validOptions = validateOptions(result, ruleName, {
			actual: primary,
			possible: [true],
		});

		if (!validOptions) return;

		root.walkDecls((decl) => {
			const value = decl.value;
			let match;

			UNIT_PATTERN.lastIndex = 0;

			while ((match = UNIT_PATTERN.exec(value)) !== null) {
				const foundUnit = match[2];
				const suggestedUnit = UNIT_MAP[foundUnit];

				if (suggestedUnit) {
					report({
						message: messages.rejected(foundUnit, suggestedUnit),
						node: decl,
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
