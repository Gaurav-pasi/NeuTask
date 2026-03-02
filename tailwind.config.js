/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        neu: {
          bg: '#1b1c1e',
          surface: '#212225',
          light: '#2a2b2f',
          dark: '#111213',
          text: '#e0e0e0',
          muted: '#7a7d85',
          accent: '#4ade80',
          'accent-dark': '#22c55e',
        }
      },
      boxShadow: {
        'neu-raised': '6px 6px 14px #111213, -6px -6px 14px #272a2d',
        'neu-raised-sm': '3px 3px 8px #111213, -3px -3px 8px #272a2d',
        'neu-pressed': 'inset 4px 4px 10px #111213, inset -4px -4px 10px #272a2d',
        'neu-pressed-sm': 'inset 2px 2px 6px #111213, inset -2px -2px 6px #272a2d',
        'glow-green': '0 0 20px rgba(74, 222, 128, 0.4), 0 0 40px rgba(74, 222, 128, 0.15)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
