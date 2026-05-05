import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'gpx/*.gpx'],
      manifest: {
        name: 'Seven Serpents',
        short_name: 'Seven Serpents',
        description: '7-segment bikepacking race planner — Slovenia & Croatia',
        theme_color: '#161b22',
        background_color: '#0d1117',
        display: 'standalone',
        orientation: 'any',
        start_url: '/seven-serpents/',
        scope: '/seven-serpents/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[abc]\.basemaps\.cartocdn\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  base: '/seven-serpents/',
})
