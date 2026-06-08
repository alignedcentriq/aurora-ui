import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Served under the /centriq subpath behind nginx — emit asset URLs prefixed accordingly.
  base: "/centriq/",
  plugins: [
    // SPA mode: build a static client bundle + prerendered index.html shell (no SSR server).
    // nginx serves the static output directly; the app is a client-auth MSAL SPA.
    tanstackStart({ spa: { enabled: true } }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 3000,
    strictPort: true,
    watch: {
      ignored: ["**/backend/**"],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        timeout: 180000,
        proxyTimeout: 180000,
      },
      "/uploads": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    allowedHosts: true,
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": "/src",
    },
  },
});
