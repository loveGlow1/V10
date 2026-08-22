/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Large-display steps beyond Tailwind's 2xl (1536px), so the layout keeps scaling
      // on 1080p/1440p/4K screens and TVs instead of topping out at desktop sizes.
      screens: {
        '3xl': '1920px',
        '4xl': '2560px',
      },
      fontFamily: {
        mono: ['Fira Code', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
};