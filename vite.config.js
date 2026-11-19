import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'push-sw.js'],
      manifest: {
        name: 'Registro Corporal',
        short_name: 'Registro',
        description: 'Comida por voz, peso, ayuno, agua y progreso',
        lang: 'es-AR',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#F5F4F0',
        theme_color: '#1B2420',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        importScripts: ['push-sw.js']
      }
    })
  ]
});
