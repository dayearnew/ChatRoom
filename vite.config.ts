/** Vite/Vue development and production build configuration for the embedded WebUI. */
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vuetify from "vite-plugin-vuetify";

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  root: "src/plugins/web/ui",
  publicDir: false,
  build: {
    outDir: "../../../../dist/web",
    emptyOutDir: false,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/mcp": "http://127.0.0.1:8765",
    },
  },
});
