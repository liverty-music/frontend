import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/no-undefined-color-token.js';

const ruleName = 'cube/no-undefined-color-token';
const tokens = ['--color-error', '--color-success'];

async function lint(code) {
	return stylelint.lint({
		code,
		config: {
			plugins: [plugin],
			rules: { [ruleName]: [true, { tokens }] },
		},
	});
}

function getWarnings(result) {
	return result.results[0].warnings.filter((w) => w.rule === ruleName);
}

describe(ruleName, () => {
	it('@spec components/infrastructure/fan/web/global/design-tokens "No undefined color"', async () => {
		const result = await lint(`
			.verify-icon {
				color: var(--color-accent);
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('--color-accent');
		expect(warnings[0].severity).toBe('error');
	});

	it('reports an undefined token even when it has a fallback', async () => {
		const result = await lint(`
			.price {
				color: var(--color-danger, oklch(62% 0.2 25deg));
			}
		`);

		expect(getWarnings(result)).toHaveLength(1);
	});

	it('reports every undefined token inside color-mix()', async () => {
		const result = await lint(`
			.badge {
				background: color-mix(in oklch, var(--color-accent) 20%, var(--color-danger));
			}
		`);

		expect(getWarnings(result)).toHaveLength(2);
	});

	it('accepts tokens the token files define', async () => {
		const result = await lint(`
			.badge {
				color: var(--color-success);
				border-color: color-mix(in oklch, var(--color-error) 40%, transparent);
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('accepts a token the stylesheet itself defines', async () => {
		const result = await lint(`
			:root {
				--color-surface-base: oklch(18% 0.04 275deg);
			}
			body {
				background: var(--color-surface-base);
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('ignores custom properties outside the --color- namespace', async () => {
		const result = await lint(`
			.icon {
				inline-size: var(--icon-size, 1em);
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});
});
