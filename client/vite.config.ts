import { defineConfig } from "vite";

export default defineConfig({
  // Art, UI and credits live in the repo's assets/ folder and are served as-is.
  publicDir: "../assets",
  server: { port: 5173 },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
});
