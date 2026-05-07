/**
 * Service Area Validation
 * Defines allowed ZIP codes and validates addresses for online booking
 */

/**
 * Standard ZIP codes for online booking with no travel charge
 */
export const STANDARD_ZIP_CODES = new Set([
  // Castle Rock / Larkspur / Castle Pines
  '80104',
  '80108',
  '80109',
  '80118',

  // Monument / Tri-Lakes
  '80132',
  '80133',

  // Falcon / Peyton
  '80831', // Falcon / Peyton

  // Colorado Springs (primary service area - north and central)
  '80903',
  '80904',
  '80905',
  '80907',
  '80908', // Black Forest
  '80909',
  '80910',
  '80913',
  '80914',
  '80915',
  '80917',
  '80918',
  '80919',
  '80920',
  '80921',
  '80922',
  '80923',
  '80924',
  '80927',
  '80929',
  '80930',
  '80938',
])

/**
 * ZIP codes that are allowed with a flat travel charge
 */
export const TRAVEL_CHARGE_ZIP_CODES = new Set([
  '80106', // Elbert
  '80107', // Elizabeth / rural Elbert County
  '80116', // Franktown / rural Douglas County
  '80120', // Littleton
  '80121', // Littleton / Greenwood Village edge
  '80122', // Centennial / Littleton
  '80123', // Littleton / Columbine
  '80124', // Lone Tree
  '80125', // Roxborough / northwest Douglas County
  '80126', // Highlands Ranch
  '80127', // Littleton / Ken Caryl
  '80128', // Littleton / Columbine Hills
  '80129', // Highlands Ranch
  '80130', // Highlands Ranch / Lone Tree edge
  '80134', // Parker
  '80138', // Parker
  '80817', // Fountain / Widefield
  '80863', // Woodland Park
  '80906', // Broadmoor / southwest Colorado Springs
  '80911', // Security-Widefield
  '80916', // Southeast Colorado Springs
  '80925', // Southeast Colorado Springs / Lorson Ranch
  '80926', // Southwest rural Colorado Springs / Fort Carson edge
])

export const TRAVEL_CHARGE_AMOUNT = 40

export const ALLOWED_ZIP_CODES = new Set([
  ...STANDARD_ZIP_CODES,
  ...TRAVEL_CHARGE_ZIP_CODES,
])

export const EXTENDED_AREA_ZIPS = TRAVEL_CHARGE_ZIP_CODES

export type ServiceAreaCheck = {
  allowed: boolean
  requiresApproval: boolean
  tier: 'standard' | 'travel_charge' | 'outside_area'
  travelCharge: number
  message: string
}

/**
 * Check if a ZIP code is within the service area for online booking
 */
export function checkServiceArea(zipCode: string): ServiceAreaCheck {
  const cleanZip = zipCode.trim().slice(0, 5) // Take first 5 digits only

  if (STANDARD_ZIP_CODES.has(cleanZip)) {
    return {
      allowed: true,
      requiresApproval: false,
      tier: 'standard',
      travelCharge: 0,
      message: 'Service area confirmed',
    }
  }

  if (TRAVEL_CHARGE_ZIP_CODES.has(cleanZip)) {
    return {
      allowed: true,
      requiresApproval: false,
      tier: 'travel_charge',
      travelCharge: TRAVEL_CHARGE_AMOUNT,
      message: `Service area confirmed with a $${TRAVEL_CHARGE_AMOUNT} travel charge.`,
    }
  }

  return {
    allowed: false,
    requiresApproval: false,
    tier: 'outside_area',
    travelCharge: 0,
    message: `Sorry, online booking is not available for ZIP code ${cleanZip}. Please call (719) 249-8791 to check availability in your area.`,
  }
}

/**
 * Get human-readable service area description
 */
export function getServiceAreaDescription(): string {
  return 'Colorado Springs, Monument, Falcon, Peyton, Black Forest, Castle Rock, Larkspur, Woodland Park, and surrounding areas'
}
