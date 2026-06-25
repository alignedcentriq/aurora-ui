import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Served under the /centriq subpath behind nginx — emit asset URLs prefixed accordingly.
  base: "/centriq/",
  plugins: [
    // SPA mode: build a static client bundle + prerendered index.html shell (no SSR server).
    // nginx serves the static output directly; the app is a client-auth MSAL SPA.
    tanstackStart({ spa: { enabled: true } }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      base: "/centriq/",
      scope: "/centriq/",
      includeAssets: ["logo.png", "avatar.png", "pwa-192.png", "pwa-512.png"],
      manifest: {
        name: "Centriq AI",
        short_name: "Centriq",
        description: "Intelligent workplace concierge for HR, IT, and admin services.",
        theme_color: "#1B6FC8",
        background_color: "#0a0f1e",
        display: "standalone",
        orientation: "any",
        start_url: "/centriq/",
        scope: "/centriq/",
        icons: [
          {
            src: "/centriq/pwa-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/centriq/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/centriq/index.html",
        // Never serve cached responses for API or upload endpoints
        navigateFallbackDenylist: [/^\/api/, /^\/uploads/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            // Auth API and backend calls — always go to network, never cache
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^\/uploads\//,
            handler: "CacheFirst",
            options: {
              cacheName: "uploads-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
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
