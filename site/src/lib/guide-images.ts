import { getImage } from 'astro:assets';
import { inferRemoteSize } from 'astro/assets/utils';
import { DIRECTUS_URL, assetFetchUrl } from './guides-build';
import { directusFileId } from './guide-image-refs';

/*
  Build-time image localization + optimization (Story 6.4 — the off-box half of
  NFR-14 / AD-13). Guide bodies carry inline <img> references to Directus
  originals (`/assets/<uuid>`, absolute or relative — the WYSIWYG stores
  either). Leaving them would (a) put the 1GB Directus box behind every public
  image (AD-2: public traffic never reaches Directus), (b) break "renders with
  Directus offline" (NFR-2), and (c) a relative `/assets/…` would simply 404 on
  the apex origin. So at build: download each referenced original (assets are
  not public — the fetch authenticates via the read token's access_token query
  param, see guides-build.assetFetchUrl), optimize it through the Astro image
  pipeline (sharp, webp), and rewrite the src to the emitted local hashed
  asset. Directus transform URLs are never requested (?width → 400 under
  storage_asset_transform:none, §18.3).

  Operates on SANITIZED body HTML only (sanitize-guide.ts runs first) — the
  sanitizer emits normalized double-quoted attributes, which is what makes the
  tag-level regex rewrite reliable. Non-Directus https images (rare hotlinks)
  pass through untouched. A download/optimize failure on a configured build
  throws = `astro build` fails loud (never ship a broken-image page silently).
*/

interface LocalizedImage {
  src: string;
  width?: string | number;
  height?: string | number;
}

/*
  Rewrite every Directus-asset <img> in the given sanitized HTML to a local,
  optimized asset. Each unique file id is optimized once per build (module-level
  cache — the same diagram embedded in three guides downloads once).
*/
const optimizedCache = new Map<string, Promise<LocalizedImage>>();

/* Width cap: wider than the ~760px reading column at 1.5x is wasted bytes.
   Smaller originals keep their intrinsic size — never upscale. */
const MAX_WIDTH = 1200;

function optimizeAsset(fileId: string): Promise<LocalizedImage> {
  let hit = optimizedCache.get(fileId);
  if (!hit) {
    hit = (async () => {
      const url = assetFetchUrl(fileId);
      try {
        // Probe the intrinsic size without registering a transform, then request
        // exactly one capped, ratio-preserving webp.
        const intrinsic = await inferRemoteSize(url);
        const width = Math.min(intrinsic.width, MAX_WIDTH);
        const height = Math.round(intrinsic.height * (width / intrinsic.width));
        const img = await getImage({ src: url, width, height, format: 'webp' });
        if (img.src.includes('access_token=')) {
          throw new Error(
            'Astro passed the remote URL through un-optimized (host not covered by image.remotePatterns?) — refusing to bake an asset URL with a token into public HTML'
          );
        }
        return {
          src: img.src,
          width: img.attributes.width ?? width,
          height: img.attributes.height ?? height,
        };
      } catch (err) {
        // Redact the access_token credential — fetch errors often echo the
        // offending URL, and this message lands in build/CI logs.
        const cause = (err instanceof Error ? err.message : String(err)).replace(
          /access_token=[^&\s"']*/g,
          'access_token=[redacted]'
        );
        throw new Error(
          `guide image localization failed for Directus asset ${fileId} — the build must not ship a broken image. Cause: ${cause}`
        );
      }
    })();
    optimizedCache.set(fileId, hit);
  }
  return hit;
}

const IMG_TAG_RE = /<img\b[^>]*>/g;
const SRC_ATTR_RE = /\ssrc="([^"]*)"/;
const ALT_ATTR_RE = /\salt="([^"]*)"/;

export async function localizeGuideImages(sanitizedHtml: string): Promise<string> {
  const tags = sanitizedHtml.match(IMG_TAG_RE);
  if (!tags) return sanitizedHtml;

  let out = sanitizedHtml;
  for (const tag of tags) {
    const src = tag.match(SRC_ATTR_RE)?.[1];
    if (!src) continue;
    const fileId = directusFileId(src, DIRECTUS_URL);
    if (!fileId) continue; // non-Directus image — leave untouched
    const img = await optimizeAsset(fileId);
    const alt = tag.match(ALT_ATTR_RE)?.[1] ?? '';
    const dims =
      img.width && img.height ? ` width="${img.width}" height="${img.height}"` : '';
    const rebuilt = `<img src="${img.src}" alt="${alt}"${dims} loading="lazy" decoding="async">`;
    out = out.split(tag).join(rebuilt);
  }
  return out;
}
