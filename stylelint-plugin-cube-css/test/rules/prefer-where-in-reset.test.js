import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/prefer-where-in-reset.js';

const ruleName = 'cube/prefer-where-in-reset';

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
	it('warns when selectors in reset layer are not wrapped in :where()', async () => {
		const result = await lint(`
			@layer reset {
				h1, h2, h3 {
					margin: 0;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(3);
		expect(warnings[0].severity).toBe('warning');
		expect(warnings[0].text).toContain('h1');
	});

	it('accepts selectors wrapped in :where()', async () => {
		const result = await lint(`
			@layer reset {
				:where(h1, h2, h3) {
					margin: 0;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('exempts :root, body, html, and * selectors', async () => {
		const result = await lint(`
			@layer reset {
				*, :root, html, body {
					margin: 0;
					box-sizing: border-box;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('warns for selectors in global layer too', async () => {
		const result = await lint(`
			@layer global {
				a {
					color: inherit;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('a');
	});

	it('ignores selectors in non-reset/global layers', async () => {
		const result = await lint(`
			@layer block {
				.card {
					color: red;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});
});
