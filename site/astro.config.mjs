// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  // Story 6.4: the build downloads + optimizes Directus-hosted guide-image
  // originals (AD-13 off-box pipeline; transforms are disabled server-side).
  // Authorize any https host (production Directus) plus the plain-http
  // localhost verify container. This only governs what the BUILD may optimize —
  // our code passes it Directus-origin URLs exclusively.
  image: {
    remotePatterns: [{ protocol: 'https' }, { protocol: 'http', hostname: 'localhost' }],
  },
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
