/**
 * Map, directions, and Street View URLs for a service address.
 *
 * These URLs were previously built inline in three places — the invoice screen,
 * the estimate screen, and the tech job screen — which is how the same feature
 * ends up behaving differently depending on which screen you opened. The URL
 * shapes live here so they cannot drift apart again.
 *
 * The visual treatment deliberately stays with each screen: the admin screens
 * use Cards, the tech screen uses its dark glass panels. Only the links are
 * shared.
 */

export type ServiceAddressLike = {
  street_1?: string | null
  street_2?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
}

/**
 * The address string the admin screens pass to Google, Apple, and Street View.
 * Kept exactly as it was written inline: street, city, then "STATE ZIP".
 */
export function formatServiceAddress(address: ServiceAddressLike): string {
  return `${address.street_1 ?? ''}, ${address.city ?? ''}, ${address.state ?? ''} ${address.zip_code ?? ''}`
}

/** Turn-by-turn directions to the address. Used by the admin job screens. */
export function googleDirectionsHref(addressText: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressText)}`
}

export function appleDirectionsHref(addressText: string): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(addressText)}&dirflg=d`
}

/** Drop a pin without starting navigation. Used by the tech job screen. */
export function googleSearchHref(addressText: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`
}

export function appleSearchHref(addressText: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(addressText)}`
}

/** Street View image, proxied so the Google key stays server-side. */
export function streetViewSrc(addressText: string): string {
  return `/api/admin/streetview?address=${encodeURIComponent(addressText)}`
}
