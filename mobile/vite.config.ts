/// <reference types="vitest" />

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, PluginOption } from 'vite'

/** روی VPS کم‌رم: VITE_LOW_MEM=1 → بدون legacy و بدون workbox سنگین */
const lowMem = process.env.VITE_LOW_MEM === '1' || process.env.VITE_LOW_MEM === 'true'

const plugins: PluginOption[] = [
  react(),
  // legacy تقریباً دو برابر رم می‌گیرد (بیلد دوم + polyfill) — عامل اصلی SIGKILL روی سرور کوچک
  ...(lowMem
    ? []
    : [
        legacy({
          targets: ['defaults', 'not IE 11'],
        }),
      ]),
  // فقط برای vite dev — در Docker production build نباید اجرا شود
  {
    ...basicSsl(),
    apply: 'serve' as const,
  },
  VitePWA({
    // روی HTTPS با گواهی نامعتبر (IP سرور) ثبت SW خطا می‌دهد و گاهی اپ را می‌شکند
    disable: lowMem,
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
]

// HTTPS لازم است تا GPS روی موبایل/IP شبکه کار کند
export default defineConfig({
  plugins,
  build: {
    // esbuild minify سبک‌تر از terser است
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    reportCompressedSize: !lowMem,
    target: 'es2019',
  },
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
