import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/no-visual-in-composition.js';

const ruleName = 'cube/no-visual-in-composition';

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
	it('rejects visual properties in composition layer', async () => {
		const result = await lint(`
			@layer composition {
				.sidebar {
					color: red;
					background-color: blue;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(2);
		expect(warnings[0].text).toContain('color');
		expect(warnings[1].text).toContain('background-color');
	});

	it('accepts structural properties in composition layer', async () => {
		const result = await lint(`
			@layer composition {
				.sidebar {
					display: grid;
					grid-template-columns: 1fr 2fr;
					gap: 1rem;
					padding: 1rem;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('ignores visual properties in non-composition layers', async () => {
		const result = await lint(`
			@layer block {
				.card {
					color: red;
					background-color: blue;
					box-shadow: 0 2px 4px rgba(0,0,0,0.1);
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('ignores declarations outside any layer', async () => {
		const result = await lint(`
			.widget {
				color: red;
				opacity: 0.5;
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('rejects box-shadow and border-radius in composition layer', async () => {
		const result = await lint(`
			@layer composition {
				.sidebar {
					box-shadow: 0 2px 4px oklch(0 0 0 / 0.1);
					border-radius: 8px;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(2);
		expect(warnings[0].text).toContain('box-shadow');
		expect(warnings[1].text).toContain('border-radius');
	});

	it('supports additionalVisualProperties option', async () => {
		const result = await lint(
			`
			@layer composition {
				.sidebar {
					cursor: pointer;
				}
			}
		`,
			[true, { additionalVisualProperties: ['cursor'] }],
		);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('cursor');
	});
});
