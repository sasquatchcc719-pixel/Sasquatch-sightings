/**
 * Public area pages on the marketing site (www.sasquatchcarpet.com) and the
 * geography used to match completed jobs to them.
 *
 * Shared by the public jobs API (which feeds "Recent Work in <area>" on each
 * area page) and the job detail pages (which link back to their area page),
 * so a job and an area page always agree on where the job belongs.
 */

const MAIN_DOMAIN = 'https://www.sasquatchcarpet.com'

export interface PublicArea {
  /** Display name, e.g. "Rockrimmon". */
  name: string
  /** Marketing-site page for this area, or null when there is none. */
  pageUrl: string | null
  /** Center point and half-width of the GPS bounding box, in degrees. */
  lat: number
  lng: number
  radius: number
  neighborhoodKeywords?: string[]
  cityFallback?: string
  /** Colorado Springs neighborhoods get linked beneath the city page. */
  isNeighborhood?: boolean
}

export const PUBLIC_AREAS: Record<string, PublicArea> = {
  // Tri-Lakes / North
  monument: {
    name: 'Monument',
    pageUrl: `${MAIN_DOMAIN}/service-areas/monument`,
    lat: 39.0917,
    lng: -104.8727,
    radius: 0.08,
    cityFallback: 'Monument',
  },
  woodmoor: {
    name: 'Woodmoor',
    pageUrl: `${MAIN_DOMAIN}/service-areas/woodmoor`,
    lat: 39.1003,
    lng: -104.8544,
    radius: 0.05,
    neighborhoodKeywords: ['Woodmoor'],
    cityFallback: 'Monument',
  },
  gleneagle: {
    name: 'Gleneagle',
    pageUrl: `${MAIN_DOMAIN}/service-areas/gleneagle`,
    lat: 39.0442,
    lng: -104.8322,
    radius: 0.05,
    neighborhoodKeywords: ['Gleneagle'],
  },
  'palmer-lake': {
    name: 'Palmer Lake',
    pageUrl: `${MAIN_DOMAIN}/service-areas/palmer-lake`,
    lat: 39.1214,
    lng: -104.9119,
    radius: 0.04,
    cityFallback: 'Palmer Lake',
  },
  'black-forest': {
    name: 'Black Forest',
    pageUrl: `${MAIN_DOMAIN}/service-areas/black-forest`,
    lat: 39.0167,
    lng: -104.6333,
    radius: 0.12,
    neighborhoodKeywords: ['Black Forest'],
    cityFallback: 'Black Forest',
  },
  falcon: {
    name: 'Falcon',
    pageUrl: `${MAIN_DOMAIN}/service-areas/falcon`,
    lat: 38.9331,
    lng: -104.6089,
    radius: 0.06,
    cityFallback: 'Falcon',
  },

  // Douglas County
  larkspur: {
    name: 'Larkspur',
    pageUrl: `${MAIN_DOMAIN}/service-areas/larkspur`,
    lat: 39.235,
    lng: -104.89,
    radius: 0.1,
    cityFallback: 'Larkspur',
  },
  'castle-rock': {
    name: 'Castle Rock',
    pageUrl: `${MAIN_DOMAIN}/service-areas/castle-rock`,
    lat: 39.3722,
    lng: -104.8561,
    radius: 0.1,
    cityFallback: 'Castle Rock',
  },
  'castle-pines': {
    name: 'Castle Pines',
    pageUrl: `${MAIN_DOMAIN}/service-areas/castle-pines`,
    lat: 39.4717,
    lng: -104.8961,
    radius: 0.05,
    cityFallback: 'Castle Pines',
  },

  // Colorado Springs — whole city
  'colorado-springs': {
    name: 'Colorado Springs',
    pageUrl: `${MAIN_DOMAIN}/service-areas/colorado-springs`,
    lat: 38.8339,
    lng: -104.8214,
    radius: 0.2,
    cityFallback: 'Colorado Springs',
  },

  // Colorado Springs neighborhoods
  'flying-horse': {
    name: 'Flying Horse',
    pageUrl: `${MAIN_DOMAIN}/service-areas/flying-horse`,
    lat: 39.0075,
    lng: -104.7597,
    radius: 0.05,
    neighborhoodKeywords: ['Flying Horse'],
    isNeighborhood: true,
  },
  rockrimmon: {
    name: 'Rockrimmon',
    pageUrl: `${MAIN_DOMAIN}/carpet-cleaning-rockrimmon-colorado-springs`,
    lat: 38.9033,
    lng: -104.8736,
    radius: 0.04,
    neighborhoodKeywords: ['Rockrimmon'],
    isNeighborhood: true,
  },
  'kissing-camels': {
    name: 'Kissing Camels',
    pageUrl: `${MAIN_DOMAIN}/carpet-cleaning-kissing-camels-colorado-springs`,
    lat: 38.89,
    lng: -104.9,
    radius: 0.03,
    neighborhoodKeywords: ['Kissing Camels'],
    isNeighborhood: true,
  },
  'mountain-shadows': {
    name: 'Mountain Shadows',
    pageUrl: `${MAIN_DOMAIN}/carpet-cleaning-mountain-shadows-colorado-springs`,
    lat: 38.875,
    lng: -104.89,
    radius: 0.04,
    neighborhoodKeywords: ['Mountain Shadows'],
    isNeighborhood: true,
  },
  'briargate-northgate': {
    name: 'Briargate & Northgate',
    pageUrl: `${MAIN_DOMAIN}/carpet-cleaning-briargate-northgate-colorado-springs`,
    lat: 38.95,
    lng: -104.78,
    radius: 0.06,
    neighborhoodKeywords: ['Briargate', 'Northgate'],
    isNeighborhood: true,
  },
  'cordera-wolf-ranch': {
    name: 'Cordera & Wolf Ranch',
    pageUrl: `${MAIN_DOMAIN}/carpet-cleaning-cordera-wolf-ranch-colorado-springs`,
    lat: 38.96,
    lng: -104.74,
    radius: 0.05,
    neighborhoodKeywords: ['Cordera', 'Wolf Ranch', 'Pine Creek'],
    isNeighborhood: true,
  },
}

/** Legacy alias still requested by the website's Briargate page. */
PUBLIC_AREAS.briargate = PUBLIC_AREAS['briargate-northgate']

interface JobLocation {
  city: string | null
  neighborhood?: string | null
  gps_fuzzy_lat?: number | null
  gps_fuzzy_lng?: number | null
}

function toSlug(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isInArea(job: JobLocation, area: PublicArea): boolean {
  if (job.gps_fuzzy_lat == null || job.gps_fuzzy_lng == null) return false
  return (
    Math.abs(job.gps_fuzzy_lat - area.lat) <= area.radius &&
    Math.abs(job.gps_fuzzy_lng - area.lng) <= area.radius
  )
}

function distanceSq(job: JobLocation, area: PublicArea): number {
  const dLat = (job.gps_fuzzy_lat ?? 0) - area.lat
  const dLng = (job.gps_fuzzy_lng ?? 0) - area.lng
  return dLat * dLat + dLng * dLng
}

function nearest(job: JobLocation, areas: PublicArea[]): PublicArea | null {
  const inside = areas.filter((a) => isInArea(job, a))
  if (inside.length === 0) return null
  return inside.reduce((best, a) =>
    distanceSq(job, a) < distanceSq(job, best) ? a : best,
  )
}

const TOWNS = Object.entries(PUBLIC_AREAS)
  .filter(([slug, a]) => !a.isNeighborhood && slug !== 'colorado-springs')
  .map(([, a]) => a)
const NEIGHBORHOODS = Object.entries(PUBLIC_AREAS)
  .filter(([slug, a]) => a.isNeighborhood && slug !== 'briargate')
  .map(([, a]) => a)

/**
 * The area page (and, inside Colorado Springs, the neighborhood page) a job
 * should link back to. The job's city decides first; GPS is the fallback for
 * misspelled or vague cities ("Colordo Springs", "Tri-Lakes Area").
 */
export function areaPagesForJob(job: JobLocation): {
  city: PublicArea | null
  neighborhood: PublicArea | null
} {
  let city: PublicArea | null = PUBLIC_AREAS[toSlug(job.city)] ?? null
  if (city?.isNeighborhood) city = null
  if (!city) {
    city = nearest(job, TOWNS)
    if (!city && isInArea(job, PUBLIC_AREAS['colorado-springs'])) {
      city = PUBLIC_AREAS['colorado-springs']
    }
  }

  let neighborhood: PublicArea | null = null
  if (city === PUBLIC_AREAS['colorado-springs']) {
    const nbhd = (job.neighborhood || '').toLowerCase()
    neighborhood =
      NEIGHBORHOODS.find((a) =>
        (a.neighborhoodKeywords || []).some((k) =>
          nbhd.includes(k.toLowerCase()),
        ),
      ) ?? nearest(job, NEIGHBORHOODS)
  }

  return { city, neighborhood }
}

/** Marketing-site service page for a services.slug from the database. */
const SERVICE_PAGE_BY_SLUG: Record<string, string> = {
  'standard-carpet-cleaning': '/services/maintenance-clean',
  'deep-carpet-restoration': '/services/deep-carpet-cleaning',
  'urine-treatment': '/services/urine-treatment',
  'rug-cleaning': '/services/rug-cleaning',
  'fabric-furniture-cleaning': '/services/fabric-furniture',
  'leather-furniture-cleaning': '/services/leather-furniture',
  'tile-grout-cleaning': '/services/tile-grout-cleaning',
  'flood-restoration': '/services/flood-restoration',
  'low-moisture-encapsulation': '/services/low-moisture-encapsulation',
  'auto-scrubbing-hard-floors': '/services/auto-scrubbing',
  'strip-wax-vct-floors': '/services/strip-wax-vct',
}

export function servicePageUrl(serviceSlug: string | null | undefined): string {
  const path = SERVICE_PAGE_BY_SLUG[serviceSlug || ''] ?? '/services'
  return `${MAIN_DOMAIN}${path}`
}
