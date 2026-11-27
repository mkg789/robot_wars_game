import os from "node:os";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  cacheDir: path.join(os.tmpdir(), "robot-wars-vite-cache"),
  plugins: [react()],
});
