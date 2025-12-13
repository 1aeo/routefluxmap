import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  server: {
    host: '192.168.5.36',
  },
  integrations: [
    react(),
    tailwind(),
  ],
  output: 'static',
  build: {
    assets: 'assets',
  },
  vite: {
    ssr: {
      noExternal: ['@deck.gl/*', 'maplibre-gl', 'react-map-gl'],
    },
  },
});


