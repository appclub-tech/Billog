import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

export default defineConfig({
  plugins: [
    // SWC plugin for decorator metadata (required for NestJS DI)
    swc.vite({
      jsc: {
        parser: {
          syntax: "typescript",
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        target: "es2022",
      },
    }),
  ],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Setup file runs before tests to configure environment
    setupFiles: ["tests/setup.ts"],
    // Run test files sequentially to avoid database conflicts
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/types/**", "src/**/*.d.ts"],
    },
    testTimeout: 30000,
  },
});
