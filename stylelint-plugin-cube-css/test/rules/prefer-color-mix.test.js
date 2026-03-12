import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/prefer-color-mix.js';

const ruleName = 'cube/prefer-color-mix';

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
	it('warns when a variant custom property uses a raw color value', async () => {
		const result = await lint(`
			@layer global {
				:root {
					--color-primary-light: oklch(0.8 0.1 250);
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('--color-primary-light');
		expect(warnings[0].text).toContain('color-mix()');
		expect(warnings[0].severity).toBe('warning');
	});

	it('accepts color-mix() for variant properties', async () => {
		const result = await lint(`
			@layer global {
				:root {
					--color-primary-hover: color-mix(in oklch, var(--color-primary), white 20%);
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('accepts relative color syntax for variant properties', async () => {
		const result = await lint(`
			@layer global {
				:root {
					--color-primary-dark: oklch(from var(--color-primary) calc(l - 0.2) c h);
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('accepts base color definitions without variant suffix', async () => {
		const result = await lint(`
			@layer global {
				:root {
					--color-primary: oklch(0.6 0.2 250);
					--color-surface: #ffffff;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('ignores variant properties outside @layer global', async () => {
		const result = await lint(`
			@layer block {
				.card {
					--color-card-hover: oklch(0.8 0.1 250);
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});
});
