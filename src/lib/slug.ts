/**
 * Slug generation utilities for job URLs
 */

/**
 * Generate a URL-safe slug for a job
 * Format: [service-slug]-[city]-[date]-[short-id]
 * Example: "urine-treatment-monument-2025-01-11-a1b2c3"
 * @param serviceName - Service name (e.g., "Urine Treatment")
 * @param city - City name (e.g., "Monument")
 */
export function generateJobSlug(serviceName: string, city: string): string {
  // Convert service name to slug format
  const serviceSlug = serviceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens

  // Convert city to slug format
  const citySlug = city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  // Generate date string (YYYY-MM-DD format)
  const date = new Date().toISOString().split('T')[0]

  // Generate short random ID (6 characters)
  const shortId = Math.random().toString(36).substring(2, 8)

  // Combine all parts
  return `${serviceSlug}-${citySlug}-${date}-${shortId}`
}
