/**
 * SEO-friendly filename generation for image uploads
 * Per .cursorrules: Follow proven patterns from official docs
 */

/**
 * Convert a string to SEO-friendly slug format
 * - Lowercase
 * - Replace spaces with hyphens
 * - Remove special characters
 * - Remove consecutive hyphens
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
}

/**
 * Generate SEO-friendly filename for job images
 * Format: {service-category}-in-{city}-{state}-{timestamp}.{ext}
 * Example: pet-urine-removal-in-monument-co-1705634892.jpg
 * 
 * @param serviceSlug - Service category slug (e.g., "standard-carpet-cleaning")
 * @param city - City name from reverse geocoding
 * @param state - State abbreviation from reverse geocoding (e.g., "CO")
 * @param originalFilename - Original uploaded filename (to extract extension)
 * @returns SEO-friendly filename
 */
export function generateSEOFilename(
  serviceSlug: string,
  city: string,
  state: string | null,
  originalFilename: string
): string {
  // Extract file extension (default to .jpg if not found)
  const extensionMatch = originalFilename.match(/\.[^.]+$/)
  const extension = extensionMatch ? extensionMatch[0] : '.jpg'

  // Slugify city and state
  const citySlug = slugify(city)
  const stateSlug = state ? slugify(state) : ''

  // Generate Unix timestamp for uniqueness
  const timestamp = Math.floor(Date.now() / 1000)

  // Build filename
  // Format: {service-slug}-in-{city}-{state}-{timestamp}.ext
  let filename = `${serviceSlug}-in-${citySlug}`
  
  if (stateSlug) {
    filename += `-${stateSlug}`
  }
  
  filename += `-${timestamp}${extension}`

  return filename
}

/**
 * Generate SEO-friendly filename for sighting images
 * Format: sasquatch-sighting-in-{city}-{state}-{timestamp}.{ext}
 * Example: sasquatch-sighting-in-denver-co-1705634892.jpg
 * 
 * @param city - City name from reverse geocoding
 * @param state - State abbreviation from reverse geocoding (e.g., "CO")
 * @param originalFilename - Original uploaded filename (to extract extension)
 * @returns SEO-friendly filename
 */
export function generateSightingSEOFilename(
  city: string | null,
  state: string | null,
  originalFilename: string
): string {
  // Extract file extension (default to .jpg if not found)
  const extensionMatch = originalFilename.match(/\.[^.]+$/)
  const extension = extensionMatch ? extensionMatch[0] : '.jpg'

  // Slugify city and state
  const citySlug = city ? slugify(city) : 'unknown'
  const stateSlug = state ? slugify(state) : ''

  // Generate Unix timestamp for uniqueness
  const timestamp = Math.floor(Date.now() / 1000)

  // Build filename
  // Format: sasquatch-sighting-in-{city}-{state}-{timestamp}.ext
  let filename = `sasquatch-sighting-in-${citySlug}`
  
  if (stateSlug) {
    filename += `-${stateSlug}`
  }
  
  filename += `-${timestamp}${extension}`

  return filename
}
