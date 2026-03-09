import { fileURLToPath } from "node:url";
import { mergeConfig, defineConfig, configDefaults } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      watch: false,
      exclude: [...configDefaults.exclude, "e2e/**"],
      root: fileURLToPath(new URL("./", import.meta.url)),
      setupFiles: ["./test/setup.ts"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html", "json-summary", "json"],
        thresholds: {
          statements: 55,
          branches: 75,
          functions: 54,
          lines: 55,
        },
        exclude: [
          ...configDefaults.coverage.exclude,
          "test/**",
          "*.config.*",
          ".storybook/**",
          // Untested page components (exclude to prevent env teardown issues)
          "src/*-page.ts",
          "src/**/*.stories.ts",
          // Main entry point (not unit testable)
          "src/main.ts",
          // Canvas components (require complex setup, deferred)
          "src/components/dna-orb/**",
          // Scripts directory
          "scripts/**",
          // Browser-env dependencies (window.location at module level)
          "src/services/auth-service.ts",
        ],
      },
    },
  }),
);