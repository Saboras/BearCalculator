## Conventions



## Known issues

### Building on Node 24 emits NO CSS — the production build ships unstyled

**Symptom:** on **Node 24**, `npm run build` succeeds but the generated `dist/` contains
**no project CSS** — no `.css` files, no `<link rel="stylesheet">`, no `<style>` beyond the
Astro Fonts API `@font-face` blocks. Every page renders **unstyled** (default serif font,
blue links). `astro dev` is unaffected on any Node (Vite injects CSS at runtime), so it is
invisible while developing — only the built artifact is broken.

**Detect it** — after a build, check a built page for a linked stylesheet. `0` = broken:

```
grep -c -- 'rel="stylesheet"' dist/finder/index.html   # 0 = broken, >0 = CSS present
```

**Root cause: Node.js v24.** Astro/Vite's static-build CSS bundling breaks on **Node
v24.17.0**. The Astro compiler still runs (every element gets its `data-astro-cid-*` scope
attribute), but Vite drops the extracted CSS instead of writing it — **silently**. Building
on **Node 22 (LTS) fixes it completely**: verified in a real browser — a Node 22 build
emits `dist/_astro/*.css` and renders pixel-identical to `astro dev`; the same code on
Node 24 ships unstyled.

**Ruled out (investigated 2026-07-01):**
- Not our code — a trivial standalone page (one scoped `<style>`, no Layout/Fonts) fails identically on Node 24.
- Not the Astro version — tested 6.2.1 / 6.3.8 / 6.4.7 / 6.4.8 (Vite 7) and 7.0.4 (Vite 8); **all** drop CSS on Node 24.
- Not `build.inlineStylesheets` (`'always'` changes nothing) or a stale cache (clearing `.astro` + `node_modules/.vite` + `dist` changes nothing).
- Confirmed fix: **Node 22.23.1 → 7 `.css` files emitted, stylesheets linked, tokens present.**

**Impact:** CI is safe — `.github/workflows/deploy.yml` pins the build to `site/.nvmrc`
(Node 22.12.0) and now hard-fails if `dist/` has no CSS. The real risk is **local** builds
on Node 24: `astro build` exits 0 and prints "Complete!" while silently dropping every
stylesheet, so a locally built/previewed `dist/` is unstyled even though `astro dev` looks
fine.

**Fix (applied):** the canonical Node pin is `site/.nvmrc` = `22.12.0` — honored by CI
(`setup-node` `node-version-file`) and by fnm/nvm locally (with shell integration).
`engines` in `package.json` tightened to `>=22.12.0 <23.0.0` as an advisory guard, and CI
gained a "Verify CSS emitted" step that fails the build when no `.css` is produced. Build
locally on Node 22 (`fnm use` / nvm honors `.nvmrc`), never Node 24. Revisit when a newer
Astro/Vite officially supports Node 24.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
