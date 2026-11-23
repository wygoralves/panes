import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// micromark decodes entities through decode-named-character-reference, whose
// "browser" build calls document.createElement when it loads. Workers have no
// document, so the markdown worker threw on startup and every long message
// fell back to the main thread. Workers get the table-based build instead.
function workerEntityDecoder(): Plugin {
  return {
    name: "panes-worker-entity-decoder",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source !== "decode-named-character-reference") {
        return null;
      }
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved) {
        return null;
      }
      return { ...resolved, id: resolved.id.replace(/index\.dom\.js$/, "index.js") };
    },
  };
}

export default defineConfig({
  plugins: [react()],
  build: {
    minify: false,
  },
  worker: {
    plugins: () => [workerEntityDecoder()],
  },
  server: {
    port: 1420,
    strictPort: true,
    hmr: {
      port: 1421
    }
  },
  clearScreen: false
});
