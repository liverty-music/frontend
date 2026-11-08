import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import stylelint from 'stylelint';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** The rules that fail for `code` under the real config, as the file at `path`. */
async function lint(code, path = 'src/components/fixture/fixture.css') {
	const { results } = await stylelint.lint({
		code,
		codeFilename: `${root}${path}`,
		configFile: `${root}stylelint.config.js`,
	});

	return results[0].warnings
		.filter((warning) => warning.severity === 'error')
		.map((warning) => warning.rule);
}

const block = (declarations) => `
@layer block {
	@scope (fixture-card) {
		:scope {
			${declarations}
		}
	}
}
`;

// @spec components/infrastructure/fan/web/global/design-tokens "No undefined color"
describe('every stylesheet', () => {
	it('references only colors and other tokens that are defined', async () => {
		const { results } = await stylelint.lint({
			files: [
				'src/**/*.css',
				'shared/**/*.css',
				'organizer/**/*.css',
				'admin/**/*.css',
				'reception/**/*.css',
			],
			cwd: root,
			configFile: `${root}stylelint.config.js`,
		});
		const unknown = results.flatMap((result) =>
			result.warnings
				.filter((warning) => warning.rule === 'no-unknown-custom-properties')
				.map((warning) => `${result.source}:${warning.line} ${warning.text}`),
		);

		expect(results.length).toBeGreaterThan(100);
		expect(unknown).toEqual([]);
		// It lints every stylesheet in the repository.
	}, 60_000);
});

describe('stylelint.config.js in a component stylesheet', () => {
	// The defect that started this: a list's `margin: 0` cancelled `.flow`,
	// because the block layer comes after the composition layer.
	it('rejects a margin that cancels .flow on a list', async () => {
		expect(await lint(block('margin: 0;'))).toContain('property-disallowed-list');
	});

	it.each([
		['padding: 0', 'padding: 0;', 'declaration-property-value-disallowed-list'],
		['padding-inline: 0', 'padding-inline: 0;', 'declaration-property-value-disallowed-list'],
		['list-style: none', 'list-style: none;', 'declaration-property-value-disallowed-list'],
		['font-family', 'font-family: serif;', 'property-disallowed-list'],
		['font', 'font: inherit;', 'property-disallowed-list'],
		['line-height', 'line-height: 1.5;', 'property-disallowed-list'],
		['letter-spacing', 'letter-spacing: 0.1em;', 'property-disallowed-list'],
		['outline', 'outline: 2px solid currentcolor;', 'property-disallowed-list'],
		['a raw box-shadow', 'box-shadow: 0 1px 2px black;', 'declaration-property-value-allowed-list'],
		['a non-elevation shadow token', '--_x: 0; box-shadow: var(--shadow-card);', 'declaration-property-custom-property-allowed-list'],
		['a non-role colour token', 'color: var(--color-text-primary);', 'declaration-property-custom-property-allowed-list'],
		['a non-shape radius token', 'border-radius: var(--radius-card);', 'declaration-property-custom-property-allowed-list'],
		['an unknown token', 'color: var(--md-sys-color-does-not-exist);', 'no-unknown-custom-properties'],
		['a physical property', 'padding-left: var(--space-s);', 'property-layout-mappings'],
		['a physical inset', 'top: 0;', 'property-layout-mappings'],
	])('rejects %s', async (_, declaration, rule) => {
		expect(await lint(block(declaration))).toContain(rule);
	});

	it('rejects a disable comment with no reason', async () => {
		const { results } = await stylelint.lint({
			code: block(`/* stylelint-disable-next-line property-disallowed-list */
			margin: 0;`),
			codeFilename: `${root}src/components/fixture/fixture.css`,
			configFile: `${root}stylelint.config.js`,
		});

		expect(results[0].warnings.map((w) => w.rule)).toContain('--report-descriptionless-disables');
		expect(results[0].errored).toBe(true);
	});

	it('rejects an unscoped disable comment and one that disables nothing', async () => {
		const { results } = await stylelint.lint({
			code: `/* stylelint-disable -- no rule named */\n${block('display: grid;')}`,
			codeFilename: `${root}src/components/fixture/fixture.css`,
			configFile: `${root}stylelint.config.js`,
		});
		const rules = results[0].warnings.map((w) => w.rule);

		expect(rules).toContain('--report-unscoped-disables');
		expect(rules).toContain('--report-needless-disables');
	});

	it('accepts a clean block', async () => {
		expect(
			await lint(
				block(`display: flex;
			gap: var(--space-s);
			padding-inline: var(--space-m);
			color: var(--color-brand-primary);
			box-shadow: none;`),
			),
		).toEqual([]);
	});

	it.each([
		['border-radius: var(--md-sys-shape-corner-large);'],
		['box-shadow: var(--md-sys-elevation-level1);'],
		['box-shadow: var(--glow-primary);'],
		['color: var(--md-sys-color-on-surface);'],
		['background: var(--_tint);'],
	])('allows the role token in %s', async (declaration) => {
		expect(await lint(block(declaration))).not.toContain(
			'declaration-property-custom-property-allowed-list',
		);
	});

	it('rejects a block over 100 lines', async () => {
		const lines = Array.from({ length: 100 }, (_, i) => `--_x${i}: 0;`).join('\n');

		expect(await lint(block(lines))).toContain('cube/block-max-lines');
	});

	it('applies to every component location and not to the shared layers', async () => {
		const margin = '@layer block {\n:host {\nmargin: 0;\n}\n}\n';

		for (const path of [
			'src/routes/fixture/fixture.css',
			'shared/ui/fixture/fixture.css',
			'src/app-shell.css',
			'src/styles/button.css',
			'organizer/ui/fixture/fixture.css',
		]) {
			expect(await lint(margin, path)).toContain('property-disallowed-list');
		}

		for (const path of [
			'organizer/styles/shared.css',
			'src/styles/compositions.css',
			'admin/users/users-route.css',
			'reception/scanner-route/scanner-route.css',
		]) {
			expect(await lint(margin, path)).not.toContain('property-disallowed-list');
		}
	});
});
