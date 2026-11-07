import requireLayer from './lib/rules/require-layer.js';
import layerOrder from './lib/rules/layer-order.js';
import exceptionDataAttr from './lib/rules/exception-data-attr.js';
import noVisualInComposition from './lib/rules/no-visual-in-composition.js';
import utilitySingleProperty from './lib/rules/utility-single-property.js';
import blockRequireScope from './lib/rules/block-require-scope.js';
import requireTokenVariables from './lib/rules/require-token-variables.js';
import blockMaxLines from './lib/rules/block-max-lines.js';
import oneBlockPerFile from './lib/rules/one-block-per-file.js';
import preferWhereInReset from './lib/rules/prefer-where-in-reset.js';
import dataAttrNaming from './lib/rules/data-attr-naming.js';
import preferViOverVw from './lib/rules/prefer-vi-over-vw.js';
import requireContainerName from './lib/rules/require-container-name.js';
import preferColorMix from './lib/rules/prefer-color-mix.js';

export default [
	requireLayer,
	layerOrder,
	exceptionDataAttr,
	noVisualInComposition,
	utilitySingleProperty,
	blockRequireScope,
	requireTokenVariables,
	blockMaxLines,
	oneBlockPerFile,
	preferWhereInReset,
	dataAttrNaming,
	preferViOverVw,
	requireContainerName,
	preferColorMix,
];
