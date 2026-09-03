import { defineMain } from '@aurelia/storybook/node'

export default defineMain({
	stories: ['../src/**/*.stories.@(ts|tsx|js|jsx|mdx)'],
	addons: [
		'@storybook/addon-a11y',
		'@storybook/addon-docs',
		'@storybook/addon-vitest',
	],
	framework: {
		name: '@aurelia/storybook',
		options: {},
	},
	core: {
		builder: '@storybook/builder-vite',
	},
	// Storybook's builder-vite auto-loads the app `vite.config.ts`, which carries
	// build-only concerns that must not leak into the Storybook/component-test
	// build (design D6 / Risk R2): `VitePWA` (injectManifest fails on Storybook's
	// own bundle) and the three-entry `rollupOptions.input`. The `@aurelia/storybook`
	// preset already adds the Aurelia Vite plugin and keeps the runtime out of
	// pre-bundling, so we only strip the app's build-time plugins/inputs here.
	viteFinal: async (config) => {
		// VitePWA registers as a nested array of sub-plugins, so flatten before
		// filtering by the shared `vite-plugin-pwa*` name prefix.
		config.plugins = (config.plugins ?? [])
			.flat(Number.POSITIVE_INFINITY)
			.filter((plugin) => {
				const name =
					plugin && typeof plugin === 'object' && 'name' in plugin
						? (plugin as { name?: string }).name
						: undefined
				return !name?.startsWith('vite-plugin-pwa')
			})
		if (config.build?.rollupOptions?.input) {
			config.build.rollupOptions.input = undefined
		}
		return config
	},
})
