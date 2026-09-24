/** Canonical URL helpers for public job pages. */

const MAIN_DOMAIN = 'https://www.sasquatchcarpet.com'

/**
 * Convert a city name to a URL-safe slug (matches sitemap.ts logic)
 */
function toCitySlug(city: string): string {
  return city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Build the main-domain URL for a job detail page.
 * Maps to the Vercel proxy: /sightings/:path* → sightings.sasquatchcarpet.com/work/:path*
 */
export function buildJobUrl(city: string, slug: string): string {
  const citySlug = toCitySlug(city || 'Colorado')
  return `${MAIN_DOMAIN}/sightings/${citySlug}/${slug}`
}
