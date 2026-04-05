import { fileURLToPath } from "node:url";
import { mergeConfig, defineConfig, configDefaults } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      // Node.js 25+ enables --experimental-webstorage by default, providing a
      // non-functional localStorage stub that shadows jsdom's implementation.
      // Disable it so jsdom can provide its own working Web Storage.
      // See: https://github.com/vitest-dev/vitest/issues/8757
      poolOptions: {
        forks: {
          execArgv: ["--no-experimental-webstorage"],
        },
      },
      watch: false,
      exclude: [...configDefaults.exclude, "e2e/**"],
      root: fileURLToPath(new URL("./", import.meta.url)),
      setupFiles: ["./test/setup.ts"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html", "json-summary", "json"],
        thresholds: {
          statements: 70,
          branches: 78,
          functions: 70,
          lines: 70,
        },
        exclude: [
          ...configDefaults.coverage.exclude,
          "test/**",
          "*.config.*",
          ".storybook/**",
          "src/**/*.stories.ts",
          // Main entry point (not unit testable)
          "src/main.ts",
          // Canvas components (require complex setup, deferred)
          "src/components/dna-orb/**",
          // Scripts directory
          "scripts/**",
          // Temporary files (not part of the app)
          "tmp/**",
          // E2E test fixtures
          "e2e/**",
        ],
      },
    },
  }),
);