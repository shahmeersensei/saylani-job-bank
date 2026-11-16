/**
 * Content Security Policy builder (audit 2026-11-11, M-20 — Phase 4 nonces).
 *
 * The CSP header is per-request because it carries a nonce, so it is built
 * in middleware — not in next.config.ts, whose headers are static. Keep the
 * directive list in sync with what the app actually needs:
 *
 * - script-src: 'self' + per-request nonce. No 'unsafe-inline': the only
 *   author-written inline script is the theme script (layout.tsx), which
 *   receives the nonce explicitly, and Next.js applies the same nonce to its
 *   own hydration scripts from the `x-nonce` request header. No
 *   'unsafe-eval' either, in any environment: the dev server runs Turbopack
 *   (not webpack), whose runtime does not evaluate code, so HMR works with
 *   a nonce-only script-src.
 * - style-src: 'self' + 'unsafe-inline' (KEPT, deliberately). A nonce cannot
 *   cover style *attributes*, and the app renders hundreds of React inline
 *   styles (`style={{...}}`) plus one inline <style> tag (landing page).
 *   Dropping 'unsafe-inline' here would break the UI with no nonce-based
 *   alternative. Revisit only if inline styles are ever removed.
 * - img-src / connect-src include the map-tile host, which is build-time env
 *   (same value next.config.ts used before). Storage is NOT listed: document
 *   uploads and downloads go through the app's own routes now, so the browser
 *   never talks to storage directly (a storage origin in CSP would also leak
 *   the server-internal storage address to every page).
 */

function originOf(url: string | undefined): string | null {
  const match = url?.match(/^https?:\/\/[^/]+/);
  return match ? match[0].replace('{s}', '*') : null;
}

export function buildCsp(nonce: string): string {
  const isProd = process.env.NODE_ENV === 'production';
  const mapTiles =
    originOf(process.env.NEXT_PUBLIC_MAP_TILE_URL) ?? 'https://tile.openstreetmap.org';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    // images.unsplash.com: landing-page photos. data:/blob:: leaflet markers and previews.
    ['img-src', "'self'", 'data:', 'blob:', 'https://images.unsplash.com', mapTiles]
      .filter(Boolean)
      .join(' '),
    // next/font/google bundles fonts at build time and serves them from 'self'.
    "font-src 'self' data:",
    // Uploads and downloads are same-origin now, so connect-src needs no storage origin.
    ['connect-src', "'self'", isProd ? null : 'ws:'].filter(Boolean).join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
