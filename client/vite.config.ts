import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Allow importing the shared protocol that lives outside the client root,
// and proxy WebSocket traffic to the game server during development.
export default defineConfig({
  server: {
    port: 5173,
    fs: {
      allow: [fileURLToPath(new URL("..", import.meta.url))],
    },
    proxy: {
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
