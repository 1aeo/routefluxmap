/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Theme: Black + Green
        'tor-black': '#0a0a0a',
        'tor-darker': '#050505',
        'tor-green': '#00ff88',
        'tor-green-dim': '#00cc6a',
        'tor-green-dark': '#004d29',
        'tor-purple': '#8b5cf6',
        'tor-orange': '#ff6600',
        'tor-gray': '#888888',
        'tor-gray-dark': '#333333',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-green': 'pulse-green 2s ease-in-out infinite',
      },
      keyframes: {
        'pulse-green': {
          '0%, 100%': { boxShadow: '0 0 10px rgba(0, 255, 136, 0.3)' },
          '50%': { boxShadow: '0 0 20px rgba(0, 255, 136, 0.6)' },
        },
      },
    },
  },
  plugins: [],
};
