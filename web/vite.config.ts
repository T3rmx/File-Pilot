import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:6969", changeOrigin: false },
      "/ws": { target: "ws://127.0.0.1:6969", ws: true },
      "/ca.crt": { target: "http://127.0.0.1:6969" },
      "/trust": { target: "http://127.0.0.1:6969" },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
