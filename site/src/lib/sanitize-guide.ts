import sanitizeHtml from 'sanitize-html';

/*
  Guide body sanitization — the infra README §18.2 forward-guard lands here
  (Story 6.4). The Directus WYSIWYG stores `guides.body` HTML AS-IS: the code
  source view and customMedia embeds let an Editor (or a compromised Editor
  account) persist arbitrary HTML. This module is the single gate between that
  stored HTML and public pages: EVERY body rendered or excerpted publicly goes
  through sanitizeGuideBody() first. Build-time only — never ships to a client
  bundle.

  Allowlist intent (FR-16 must survive, everything hostile must die):
  - tables/headings/lists/links: sanitize-html defaults
  - <img>: allowed (guide images; localized by guide-images.ts AFTER this)
  - <iframe>: allowed ONLY for YouTube hosts (embedded video); every other
    iframe src is stripped by allowedIframeHostnames
  - <script>, event handlers, javascript: URLs: dead (defaults)
  - style/class attributes: stripped — the site's readability tokens own
    typography and contrast (NFR-5), WYSIWYG inline styling cannot override
  - body <h1> is demoted to <h2>: the page's <h1> is the guide title
    (UX-DR-22 heading nesting)
  - target="_blank" links get rel="noopener noreferrer" forced
*/
export function sanitizeGuideBody(body: string | null | undefined): string {
  if (!body) return '';
  return sanitizeHtml(body, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'iframe']),
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      iframe: ['src', 'width', 'height', 'allowfullscreen', 'frameborder', 'allow'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
    },
    allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com'],
    // http covers the localhost verify container; production bodies carry https.
    allowedSchemes: ['https', 'http'],
    allowProtocolRelative: false,
    transformTags: {
      h1: 'h2',
      a: (tagName, attribs) =>
        // target values are ASCII case-insensitive in HTML — catch _BLANK too.
        attribs.target?.toLowerCase() === '_blank'
          ? { tagName, attribs: { ...attribs, rel: 'noopener noreferrer' } }
          : { tagName, attribs },
    },
  });
}

/*
  Plain-text excerpt of a SANITIZED body for the search index and meta
  descriptions: tags stripped, the sanitizer's HTML escapes decoded back to
  plain text (consumers re-escape for their own context — Astro attributes,
  JSON — so leaving them encoded would double-encode "&" into "&amp;" in
  unfurls), whitespace collapsed, cut at a word boundary near `max` chars.
*/
export function stripToExcerpt(sanitizedHtml: string, max = 200): string {
  const text = sanitizeHtml(sanitizedHtml, { allowedTags: [], allowedAttributes: {} })
    // sanitize-html output is HTML text — decode its four escapes, &amp; LAST
    // so a literal "&lt;" in the source stays "&lt;" instead of becoming "<".
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  let head = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  // Never cut through a surrogate pair (emoji/astral chars → lone "�").
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return head.trimEnd() + '…';
}
