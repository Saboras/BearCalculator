# Kingdom 1516 — site

Astro static site for the Kingdom 1516 Kingshot companion (MVP-1: public, no backend).
The legacy single-file Bear Trap calculator stays live at the repo root (GitHub Pages) until cutover.

## Commands

All commands run from `site/`:

| Command           | Action                                       |
| :---------------- | :------------------------------------------- |
| `npm ci`          | Install pinned dependencies                  |
| `npm run dev`     | Start the local dev server (`localhost:4321`) |
| `npm run build`   | Build the static site to `./dist/`           |
| `npm run preview` | Preview the production build locally          |

## Stack

- Astro 6 (`output: 'static'`), Node 22 LTS (≥ 22.12, see `.nvmrc`).
- Fonts (Inter, Lilita One) are self-hosted via the Astro Fonts API — no runtime CDN call.
- Design tokens + themes (Banner Gold light / Royal Court dark) live in `src/styles/global.css`.

Docs: https://docs.astro.build
