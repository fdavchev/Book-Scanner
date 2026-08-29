import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// The OCR language data and WASM cores live in public/tesseract/ (put there by
// scripts/vendor-ocr.mjs). They are deliberately NOT precached — they are large and
// device-specific, so the app fetches exactly the ones it needs during the first-run
// "Set up offline scanning" step and they are held by the CacheFirst route below.
// GitHub Pages serves a project site from a subpath (/repo-name/), so the base is
// configurable. `npm run deploy` sets it automatically; everything else defaults to '/'.
const base = process.env.VITE_BASE ?? '/'

export default defineConfig(({ mode }) => ({
  base,
  plugins: [
    react(),
    // `npm run dev:https` serves over HTTPS so a phone on the LAN can use the camera.
    ...(mode === 'https' ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Book Scanner',
        short_name: 'Books',
        description: 'Scan book covers and keep a private, offline collection on your phone.',
        theme_color: '#1c1917',
        background_color: '#1c1917',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell only. `/tesseract/*` is excluded here and cached on demand instead.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        globIgnores: ['**/tesseract/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            // Once fetched, an OCR asset is served from the cache forever — this is what
            // makes scanning work with the network off.
            urlPattern: ({ url }) => url.pathname.includes('/tesseract/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-assets',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
}))
