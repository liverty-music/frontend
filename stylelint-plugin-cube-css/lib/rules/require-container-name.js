import stylelint from 'stylelint';

const {
	createPlugin,
	utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cube/require-container-name';

const messages = ruleMessages(ruleName, {
	rejected: () =>
		'Expected a "container-name" declaration (or "container" shorthand) alongside "container-type".',
});

const meta = {
	url: 'https://github.com/liverty-music/frontend/tree/main/stylelint-plugin-cube-css/lib/rules/require-container-name.md',
	fixable: false,
};

const ruleFunction = (primary) => {
	return (root, result) => {
		const validOptions = validateOptions(result, ruleName, {
			actual: primary,
			possible: [true],
		});

		if (!validOptions) return;

		root.walkDecls('container-type', (decl) => {
			// "normal" resets container-type — no name required.
			if (decl.value.trim().toLowerCase() === 'normal') {
				return;
			}

			const parent = decl.parent;

			if (!parent) return;

			let hasContainerName = false;

			parent.walkDecls((sibling) => {
				const prop = sibling.prop.toLowerCase();

				if (prop === 'container-name' || prop === 'container') {
					hasContainerName = true;
				}
			});

			if (!hasContainerName) {
				report({
					message: messages.rejected(),
					node: decl,
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
