import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/data-attr-naming.js';

const ruleName = 'cube/data-attr-naming';

async function lint(code, config = true) {
	return stylelint.lint({
		code,
		config: {
			plugins: [plugin],
			rules: { [ruleName]: config },
		},
	});
}

function getWarnings(result) {
	return result.results[0].warnings.filter((w) => w.rule === ruleName);
}

describe(ruleName, () => {
	it('accepts allowed data attributes in exception layer', async () => {
		const result = await lint(`
			@layer exception {
				[data-state="active"] {
					opacity: 1;
				}
				[data-variant="primary"] {
					background: blue;
				}
				[data-theme="dark"] {
					color: white;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('rejects disallowed data attributes in exception layer', async () => {
		const result = await lint(`
			@layer exception {
				[data-custom="value"] {
					color: red;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('data-custom');
	});

	it('supports additionalAttributes option', async () => {
		const result = await lint(
			`
			@layer exception {
				[data-animation="fade"] {
					opacity: 0;
				}
			}
		`,
			[true, { additionalAttributes: ['data-animation'] }],
		);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('ignores data attributes in non-exception layers', async () => {
		const result = await lint(`
			@layer block {
				[data-whatever="foo"] {
					color: red;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('catches multiple disallowed attributes in a single selector', async () => {
		const result = await lint(`
			@layer exception {
				[data-foo][data-bar="baz"] {
					color: red;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(2);
		expect(warnings[0].text).toContain('data-foo');
		expect(warnings[1].text).toContain('data-bar');
	});
});
