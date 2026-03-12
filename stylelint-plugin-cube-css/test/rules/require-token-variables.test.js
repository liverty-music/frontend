import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/require-token-variables.js';

const ruleName = 'cube/require-token-variables';

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
	it('rejects raw values for enforced properties in consumption layers', async () => {
		const result = await lint(`
			@layer block {
				@scope (.card) {
					:scope {
						color: red;
						padding: 16px;
						font-size: 1.5rem;
					}
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(3);
		expect(warnings[0].text).toContain('color');
		expect(warnings[1].text).toContain('padding');
		expect(warnings[2].text).toContain('font-size');
	});

	it('accepts var() values for enforced properties', async () => {
		const result = await lint(`
			@layer block {
				@scope (.card) {
					:scope {
						color: var(--color-text);
						padding: var(--space-m);
						font-size: var(--step-1);
					}
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('accepts structural values without var()', async () => {
		const result = await lint(`
			@layer block {
				@scope (.card) {
					:scope {
						padding: 0;
						margin: auto;
						color: inherit;
						background-color: transparent;
						box-shadow: none;
					}
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('ignores declarations in reset and global layers by default', async () => {
		const result = await lint(`
			@layer reset {
				* {
					margin: 0;
					padding: 0;
					box-shadow: none;
				}
			}
			@layer global {
				body {
					color: #333;
					font-size: 16px;
					line-height: 1.5;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('rejects calc() without var() reference', async () => {
		const result = await lint(`
			@layer composition {
				.sidebar {
					padding: calc(16px + 8px);
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('calc()');
		expect(warnings[0].text).toContain('var()');
	});

	it('accepts calc() that contains var()', async () => {
		const result = await lint(`
			@layer composition {
				.sidebar {
					padding: calc(var(--space-m) + 4px);
					margin: calc(var(--space-s) * 2);
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('ignores non-enforced properties', async () => {
		const result = await lint(`
			@layer block {
				@scope (.card) {
					:scope {
						display: grid;
						position: relative;
						z-index: 10;
						width: 100%;
					}
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('supports custom properties option', async () => {
		const result = await lint(
			`
			@layer block {
				@scope (.card) {
					:scope {
						width: 300px;
						color: red;
					}
				}
			}
		`,
			[true, { properties: ['width'] }],
		);
		const warnings = getWarnings(result);

		// Only 'width' is enforced; 'color' is not in the custom list
		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('width');
	});

	it('supports custom ignoreLayers option', async () => {
		const result = await lint(
			`
			@layer global {
				body {
					color: #333;
					font-size: 16px;
				}
			}
		`,
			[true, { ignoreLayers: ['reset'] }],
		);
		const warnings = getWarnings(result);

		// global is no longer ignored, so these should be reported
		expect(warnings).toHaveLength(2);
	});

	it('enforces in all consumption layers', async () => {
		const result = await lint(`
			@layer composition {
				.sidebar { gap: 10px; }
			}
			@layer utility {
				.flow > * + * { margin-block-start: 1em; }
			}
			@layer exception {
				.card[data-variant="featured"] { background-color: gold; }
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(3);
	});

	it('accepts currentColor as a structural value', async () => {
		const result = await lint(`
			@layer block {
				@scope (.card) {
					:scope {
						color: currentColor;
						border-color: currentColor;
					}
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('accepts grid fractions as structural values', async () => {
		const result = await lint(`
			@layer composition {
				.grid {
					grid-template-columns: 1fr 2fr;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('enforces duration properties', async () => {
		const result = await lint(`
			@layer block {
				@scope (.card) {
					:scope {
						transition-duration: 200ms;
						animation-duration: 1s;
					}
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(2);
		expect(warnings[0].text).toContain('transition-duration');
		expect(warnings[1].text).toContain('animation-duration');
	});

	it('accepts var() for duration properties', async () => {
		const result = await lint(`
			@layer block {
				@scope (.card) {
					:scope {
						transition-duration: var(--duration-fast);
						animation-duration: var(--duration-slow);
						transition-timing-function: var(--ease-out);
					}
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
				padding: 16px;
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});
});
