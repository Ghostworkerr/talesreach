import { cpSync, existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const WEB_DIR = resolve(here, "../web");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

/**
 * The website pages (homepage, rules, privacy, credits, PWA files) live in web/ as
 * plain HTML. In development they're served by Vite; in a build they're copied
 * next to the game, so the site is: / (home), /play/ (the game), /rules.html …
 */
function webPages(): Plugin {
  return {
    name: "talesreach-web-pages",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "/").split("?")[0]!;
        const rel = url === "/" ? "index.html" : decodeURIComponent(url.slice(1));
        // Only plain file names inside web/ (no "..", no hidden files).
        if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*\.[a-z]+$/.test(rel)) return next();
        const file = resolve(WEB_DIR, rel);
        if (!file.startsWith(WEB_DIR) || !existsSync(file)) return next();
        res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      cpSync(WEB_DIR, resolve(here, "dist"), { recursive: true });
    },
  };
}

export default defineConfig({
  // Art, UI, audio, maps and credits live in the repo's assets/ folder and are served as-is.
  publicDir: "../assets",
  plugins: [webPages()],
  server: { port: 5173 },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: { play: resolve(here, "play/index.html") },
    },
  },
});
