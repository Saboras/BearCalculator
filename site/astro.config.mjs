// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  // Self-host fonts via the Astro Fonts API (stable in Astro 6). The fontsource
  // provider downloads + subsets + serves them from our own origin at build time,
  // so public pages have no runtime third-party (googleapis.com) dependency.
  fonts: [
    {
      name: 'Inter',
      cssVariable: '--font-inter',
      provider: fontProviders.fontsource(),
      weights: [400, 600, 700],
      styles: ['normal'],
      fallbacks: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
    },
    {
      name: 'Lilita One',
      cssVariable: '--font-lilita-one',
      provider: fontProviders.fontsource(),
      weights: [400],
      styles: ['normal'],
      fallbacks: ['var(--font-inter)', 'sans-serif'],
    },
  ],
});
