import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/block-require-scope.js';

const ruleName = 'cube/block-require-scope';

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
	it('rejects rules in block layer without @scope', async () => {
		const result = await lint(`
			@layer block {
				.card {
					color: red;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('.card');
		expect(warnings[0].text).toContain('@scope');
	});

	it('accepts rules in block layer wrapped in @scope', async () => {
		const result = await lint(`
			@layer block {
				@scope (.card) {
					:scope {
						color: red;
					}
					.title {
						font-size: 1.5rem;
					}
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('ignores rules in non-block layers', async () => {
		const result = await lint(`
			@layer composition {
				.sidebar {
					display: grid;
				}
			}
			@layer utility {
				.flow > * + * {
					margin-block-start: 1rem;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('ignores rules outside any layer', async () => {
		const result = await lint(`
			.widget {
				color: red;
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('reports multiple rules in block layer without @scope', async () => {
		const result = await lint(`
			@layer block {
				.card {
					color: red;
				}
				.header {
					font-size: 2rem;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(2);
		expect(warnings[0].text).toContain('.card');
		expect(warnings[1].text).toContain('.header');
	});

	it('accepts @scope with to() limit', async () => {
		const result = await lint(`
			@layer block {
				@scope (.card) to (.card__content) {
					:scope {
						padding: 1rem;
					}
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});
});
