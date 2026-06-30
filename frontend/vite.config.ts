import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build-time app version from git (tag, else short commit). Never fails the build.
function gitVersion(): string {
  try {
    return execSync("git describe --tags --always", { // Could add --dirty to catch uncommitted changes
      encoding: "utf8",
    }).trim();
  } catch {
    return "dev";
  }
}

// Dev server proxies /api to the local backend so cookies stay same-origin.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(gitVersion()),
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
