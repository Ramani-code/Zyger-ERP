import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'Zyger_Logo.svg', 'icons.svg'],
      manifest: {
        name: 'Zyger ERP — Precision Manufacturing ERP',
        short_name: 'Zyger ERP',
        description: 'CNC Manufacturing ERP for quality, maintenance, and production',
        theme_color: '#1e293b',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['business', 'productivity', 'utilities'],
        icons: [
          { src: 'icons.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: 'icons.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The Zyger_Logo.svg asset is large; raise the precache limit so
        // `vite build` does not fail on it. Tune to the largest asset size.
        maximumFileSizeToCacheInBytes: 1024 * 1024 * 10,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/(v1\/production|v1\/planning|v2\/master|v1\/quality|maintenance)\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-v1-cache', networkTimeoutSeconds: 10, expiration: { maxEntries: 200, maxAgeSeconds: 3600 } }
          },
          {
            // NetworkFirst (not StaleWhileRevalidate): master-data screens
            // (items, item groups, etc.) need to show a just-saved record
            // immediately, not a cached copy from up to 24h ago. Falls back
            // to cache only if the network is actually unavailable.
            urlPattern: /^\/api\/master\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'master-data', networkTimeoutSeconds: 8, expiration: { maxEntries: 50, maxAgeSeconds: 3600 } }
          },
          {
            urlPattern: /^\/api\/v1\/master\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'v2-master-data', networkTimeoutSeconds: 8, expiration: { maxEntries: 100, maxAgeSeconds: 3600 } }
          }
        ]
      }
    })
  ],
  build: {
  },
  server: {
    port: 9091,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:9090',
    },
  },
})
