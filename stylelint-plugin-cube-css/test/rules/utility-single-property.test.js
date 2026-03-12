import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/utility-single-property.js';

const ruleName = 'cube/utility-single-property';

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
	it('accepts utility selectors with 2 or fewer declarations (default max)', async () => {
		const result = await lint(`
			@layer utility {
				.text-center {
					text-align: center;
				}
				.flow > * + * {
					margin-block-start: var(--flow-space, 1em);
					display: block;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('rejects utility selectors exceeding default max of 2', async () => {
		const result = await lint(`
			@layer utility {
				.kitchen-sink {
					color: red;
					background: blue;
					font-size: 1rem;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('.kitchen-sink');
		expect(warnings[0].text).toContain('3');
		expect(warnings[0].text).toContain('2');
	});

	it('supports custom max option', async () => {
		const result = await lint(
			`
			@layer utility {
				.text-center {
					text-align: center;
					display: block;
				}
			}
		`,
			[true, { max: 1 }],
		);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('2');
		expect(warnings[0].text).toContain('1');
	});

	it('ignores selectors in non-utility layers', async () => {
		const result = await lint(`
			@layer block {
				.card {
					color: red;
					background: blue;
					font-size: 1rem;
					padding: 1rem;
					margin: 0;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('accepts visually-hidden pattern with raised max', async () => {
		const result = await lint(
			`
			@layer utility {
				.visually-hidden {
					position: absolute;
					inline-size: 1px;
					block-size: 1px;
					padding: 0;
					margin: -1px;
					overflow: hidden;
				}
			}
		`,
			[true, { max: 6 }],
		);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('rejects visually-hidden pattern with default max', async () => {
		const result = await lint(`
			@layer utility {
				.visually-hidden {
					position: absolute;
					inline-size: 1px;
					block-size: 1px;
					padding: 0;
					margin: -1px;
					overflow: hidden;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('6');
		expect(warnings[0].text).toContain('2');
	});

	it('ignores selectors outside any layer', async () => {
		const result = await lint(`
			.something {
				color: red;
				background: blue;
				font-size: 1rem;
				padding: 1rem;
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});
});
