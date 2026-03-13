import { describe, it, expect } from 'vitest';
import postcss from 'postcss';
import {
	getLayerContext,
	CUBE_LAYERS,
	CUBE_LAYER_SET,
} from '../../lib/utils/get-layer-context.js';

function parse(css) {
	return postcss.parse(css);
}

describe('getLayerContext', () => {
	it('returns layer name for a declaration inside @layer', () => {
		const root = parse('@layer block { .card { color: red; } }');
		const decl = root.first.first.first;

		expect(getLayerContext(decl)).toBe('block');
	});

	it('returns null for a declaration outside any @layer', () => {
		const root = parse('.card { color: red; }');
		const decl = root.first.first;

		expect(getLayerContext(decl)).toBeNull();
	});

	it('returns the innermost layer for nested @layer blocks', () => {
		const root = parse(
			'@layer block { @layer inner { .card { color: red; } } }',
		);
		const decl = root.first.first.first.first;

		expect(getLayerContext(decl)).toBe('inner');
	});

	it('returns layer name through @scope nesting', () => {
		const root = parse(
			'@layer block { @scope (.card) { :scope { color: red; } } }',
		);
		const decl = root.first.first.first.first;

		expect(getLayerContext(decl)).toBe('block');
	});

	it('handles each CUBE layer name correctly', () => {
		for (const layer of CUBE_LAYERS) {
			const root = parse(`@layer ${layer} { .x { color: red; } }`);
			const decl = root.first.first.first;

			expect(getLayerContext(decl)).toBe(layer);
		}
	});

	it('returns null for @layer without params (declaration-only)', () => {
		const root = parse(
			'@layer reset, global, composition, utility, block, exception;',
		);

		// AtRule node for declaration-only @layer has no children to walk into,
		// but the node itself should return null if passed
		expect(getLayerContext(root.first)).toBeNull();
	});
});

describe('CUBE_LAYERS', () => {
	it('has correct order', () => {
		expect(CUBE_LAYERS).toEqual([
			'reset',
			'tokens',
			'global',
			'composition',
			'utility',
			'block',
			'exception',
		]);
	});
});

describe('CUBE_LAYER_SET', () => {
	it('contains all CUBE layers', () => {
		for (const layer of CUBE_LAYERS) {
			expect(CUBE_LAYER_SET.has(layer)).toBe(true);
		}
	});

	it('does not contain non-CUBE layer names', () => {
		expect(CUBE_LAYER_SET.has('foo')).toBe(false);
	});
});
