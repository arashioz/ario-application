/// <reference types="vitest" />

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// HTTPS لازم است تا GPS روی موبایل/IP شبکه کار کند
export default defineConfig({
  plugins: [
    react(),
    legacy(),
    basicSsl(),
    VitePWA({
      // روی HTTPS با گواهی نامعتبر (IP سرور) ثبت SW خطا می‌دهد و گاهی اپ را می‌شکند
      injectRegister: null,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'assets/icon/*.png'],
      manifest: {
        name: 'آریو | مدیریت مغازه',
        short_name: 'آریو',
        description: 'سیستم مدیریت فروشگاه عمده قند و شکر',
        theme_color: '#1e3a5f',
        background_color: '#0f2744',
        display: 'standalone',
        lang: 'fa',
        dir: 'rtl',
        start_url: '/',
        icons: [
          {
            src: 'assets/icon/icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:3001', ws: true, changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
})
