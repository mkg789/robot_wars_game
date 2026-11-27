import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default defineConfig({
  ...viteConfig,
  cacheDir: path.join(os.tmpdir(), "robot-wars-vitest-cache"),
  test: {
    include: ["src/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
  },
});
