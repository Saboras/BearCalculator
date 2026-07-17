/*
  Pure Directus-asset reference logic (Story 6.4) — separated from
  guide-images.ts so it is unit-testable in plain Node (guide-images imports
  astro:assets, which only exists inside an Astro build).
*/
const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/*
  Extract the Directus file id from an img src, or null when the src is not a
  Directus asset. Handles: relative "/assets/<id>" and absolute URLs matched by
  HOSTNAME against directusUrl — not by exact origin, so a protocol/port/case
  variant of the configured URL (the WYSIWYG stores whatever origin the Studio
  session used) still localizes instead of silently shipping a Directus URL in
  public HTML (AD-2). One host = one Directus at this deployment's scale.
  Tolerates trailing "/<filename>" and query strings. Genuinely foreign hosts
  return null (hotlinks pass through untouched).
*/
export function directusFileId(src: string, directusUrl: string): string | null {
  let path: string;
  if (src.startsWith('//')) {
    return null; // protocol-relative — the sanitizer rejects these anyway
  }
  if (src.startsWith('/')) {
    path = src;
  } else {
    let srcUrl: URL;
    let dirUrl: URL;
    try {
      srcUrl = new URL(src);
      dirUrl = new URL(directusUrl);
    } catch {
      return null;
    }
    if (srcUrl.hostname.toLowerCase() !== dirUrl.hostname.toLowerCase()) return null;
    path = srcUrl.pathname + srcUrl.search;
  }
  const m = path.match(new RegExp(`^/assets/(${UUID_RE})(?:[/?]|$)`));
  return m ? m[1] : null;
}
