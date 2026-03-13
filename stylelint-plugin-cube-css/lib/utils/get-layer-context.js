/**
 * Walk PostCSS ancestors to find the enclosing @layer name.
 * Returns the layer name string or null if the node is not inside any @layer.
 */
export function getLayerContext(node) {
	let current = node.parent;

	while (current) {
		if (current.type === 'atrule' && current.name === 'layer') {
			// @layer block has params like "block" or "composition"
			const layerName = current.params?.trim();

			if (layerName) {
				return layerName;
			}
		}

		current = current.parent;
	}

	return null;
}

/** Canonical CUBE CSS layer order. */
export const CUBE_LAYERS = [
	'reset',
	'tokens',
	'global',
	'composition',
	'utility',
	'block',
	'exception',
];

/** Set for quick membership checks. */
export const CUBE_LAYER_SET = new Set(CUBE_LAYERS);
