import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "https://127.0.0.1:6969",
        // Keep the browser's Host header so same-origin (CSRF) checks pass.
        changeOrigin: false,
        secure: false,
      },
      "/ws": { target: "wss://127.0.0.1:6969", ws: true, secure: false },
      "/ca.crt": { target: "https://127.0.0.1:6969", secure: false },
      "/trust": { target: "https://127.0.0.1:6969", secure: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
