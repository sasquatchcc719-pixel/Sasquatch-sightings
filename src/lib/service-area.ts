/**
 * Service Area Validation
 * Defines allowed ZIP codes and validates addresses for online booking
 */

/**
 * Allowed ZIP codes for online booking
 *
 * Primary service area as defined in Harry AI control:
 * - Tri-Lakes (Monument, Palmer Lake)
 * - Castle Rock / Larkspur
 * - North Colorado Springs
 * - Falcon / Peyton / Elbert
 */
export const ALLOWED_ZIP_CODES = new Set([
  // Castle Rock
  '80104',
  '80109',

  // Larkspur
  '80118',

  // Monument / Tri-Lakes
  '80132',
  '80133',

  // Colorado Springs (primary service area - north and central)
  '80817', // Also Fountain
  '80829', // Also Peyton
  '80831', // Falcon / Peyton
  '80903',
  '80904',
  '80905',
  '80906',
  '80907',
  '80908', // Black Forest
  '80909',
  '80910',
  '80911',
  '80913',
  '80914',
  '80915',
  '80916',
  '80917',
  '80918',
  '80919',
  '80920',
  '80921',
  '80922',
  '80923',
  '80924',
  '80925',
  '80926',
  '80927',
  '80928',
  '80929',
  '80930',
  '80938',

  // Woodland Park (may require travel fee confirmation)
  '80863',

  // Fountain
  '80817',

  // Elbert
  '80106',
])

/**
 * ZIP codes that may require travel fee or owner approval
 * (still allowed to book online but flagged for review)
 */
export const EXTENDED_AREA_ZIPS = new Set([
  '80863', // Woodland Park
  '80106', // Elbert
])

export type ServiceAreaCheck = {
  allowed: boolean
  requiresApproval: boolean
  message: string
}

/**
 * Check if a ZIP code is within the service area for online booking
 */
export function checkServiceArea(zipCode: string): ServiceAreaCheck {
  const cleanZip = zipCode.trim().slice(0, 5) // Take first 5 digits only

  if (ALLOWED_ZIP_CODES.has(cleanZip)) {
    const requiresApproval = EXTENDED_AREA_ZIPS.has(cleanZip)

    if (requiresApproval) {
      return {
        allowed: true,
        requiresApproval: true,
        message:
          'This location may require a travel fee. The office will confirm details shortly.',
      }
    }

    return {
      allowed: true,
      requiresApproval: false,
      message: 'Service area confirmed',
    }
  }

  return {
    allowed: false,
    requiresApproval: false,
    message: `Sorry, online booking is not available for ZIP code ${cleanZip}. Please call (719) 249-8791 to check availability in your area.`,
  }
}

/**
 * Get human-readable service area description
 */
export function getServiceAreaDescription(): string {
  return 'Colorado Springs, Monument, Falcon, Peyton, Black Forest, Castle Rock, Larkspur, Woodland Park, and surrounding areas'
}
