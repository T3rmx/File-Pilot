import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "https://127.0.0.1:6969",
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            // Forward cookies from browser request to backend
            const cookie = req.headers.cookie;
            if (cookie) proxyReq.setHeader("cookie", cookie);
          });
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            // Forward Set-Cookie headers from backend to browser
            const setCookie = proxyRes.headers["set-cookie"];
            if (setCookie) res.setHeader("set-cookie", setCookie);
          });
        },
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
