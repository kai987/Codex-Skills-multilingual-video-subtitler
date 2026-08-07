import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mvl/shared": `${root}packages/shared/src/index.ts`,
      "@mvl/media-identity": `${root}packages/media-identity/src/index.ts`,
      "@mvl/subtitle-core": `${root}packages/subtitle-core/src/index.ts`,
      "@mvl/subtitle-search": `${root}packages/subtitle-search/src/index.ts`,
      "@mvl/transcription-core": `${root}packages/transcription-core/src/index.ts`,
      "@mvl/grammar-report-core": `${root}packages/grammar-report-core/src/index.ts`,
      "@mvl/site-builder-core": `${root}packages/site-builder-core/src/index.ts`,
      "@mvl/pipeline-core": `${root}packages/pipeline-core/src/index.ts`,
      "@mvl/video-subtitler": `${root}packages/video-subtitler/src/index.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
