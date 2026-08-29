/** @type {import('tailwindcss').Config} */
module.exports = {
  /* Tailwind 3 compiles `hover:` to a plain :hover, which a touchscreen synthesises on
     tap and then holds until you tap elsewhere — every hover:scale and hover:bg in the
     app sticks after a tap. This wraps them all in @media (hover: hover), which is what
     v4 does by default. Capability, not width: a narrow laptop window still has a mouse
     and keeps its hovers. */
  future: { hoverOnlyWhenSupported: true },
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Registering the brand palette here is what lets Tailwind generate the composed
      // variants the markup already uses — `bg-brandGreen/10`, `border-brandGreen/40`,
      // `focus:ring-brandGreen/40`, `hover:bg-brandSurfaceAccent`. Tailwind only emits a
      // class it can see in the theme, so while these colours existed solely as
      // hand-written CSS rules every one of those variants compiled to nothing and the
      // markup referencing them rendered untinted. The `<alpha-value>` placeholder is
      // where Tailwind substitutes the opacity modifier; the channel triplets it reads
      // are defined once in src/app/globals.css.
      colors: {
        brandBg: 'rgb(var(--brandBg-rgb) / <alpha-value>)',
        brandSurface: 'rgb(var(--brandSurface-rgb) / <alpha-value>)',
        brandSurfaceAccent: 'rgb(var(--brandSurfaceAccent-rgb) / <alpha-value>)',
        brandGreen: 'rgb(var(--brandGreen-rgb) / <alpha-value>)',
        brandTextSec: 'rgb(var(--brandTextSec-rgb) / <alpha-value>)',
        // Bakes in its own alpha, so it takes no opacity modifier.
        brandBorder: 'var(--brandBorder)',

        // The theme. Every one of these is a role rather than a colour — what the
        // thing is for, not what it looks like — so the two palettes in
        // globals.css can disagree about the colour without a single class in the
        // markup changing. Channel triplets for the same reason as the brand
        // colours above: it is what lets `bg-layer/[0.06]` compose.
        ink: 'rgb(var(--ink) / <alpha-value>)',
        soft: 'rgb(var(--soft) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        // The tint every translucent fill and hairline is made of. White on a dark
        // ground, near-black on a light one — which is what flips ~300 overlays in
        // this app without touching one of them.
        layer: 'rgb(var(--layer) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        bar: 'rgb(var(--bar) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',
        // A primary button and the text on it, which swap ends between themes.
        solid: 'rgb(var(--solid) / <alpha-value>)',
        onSolid: 'rgb(var(--on-solid) / <alpha-value>)',
        // Brand colours that have to be re-picked for a light ground: mint on white
        // is unreadable, and so is coral.
        accent: 'rgb(var(--accent) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        // Gold as *text*. The gold fills keep their literal gradients: they carry
        // dark text on them and read on either ground.
        warn: 'rgb(var(--warn) / <alpha-value>)',
      },
      // Large-display steps beyond Tailwind's 2xl (1536px), so the layout keeps scaling
      // on 1080p/1440p/4K screens and TVs instead of topping out at desktop sizes.
      screens: {
        '3xl': '1920px',
        '4xl': '2560px',
      },
      fontFamily: {
        mono: ['Fira Code', 'Courier New', 'monospace'],
        // Loaded in src/app/layout.tsx via next/font and applied where a section opts in
        // with `font-display`; the system stack behind it covers the swap window.
        display: ['var(--font-display)', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
      },
    },
  },
  plugins: [],
};