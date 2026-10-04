import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    lib: {
      entry: "src/card.ts",
      formats: ["es"],
      fileName: () => "heizlast-ha-card.js",
    },
    rolldownOptions: { output: { codeSplitting: false } },
  },
  test: { environment: "jsdom", include: ["tests/**/*.test.ts"] },
  server: { fs: { allow: [".."] } },
});
