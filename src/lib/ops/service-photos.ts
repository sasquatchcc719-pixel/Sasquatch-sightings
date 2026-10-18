export type ServicePhotoIdentity = {
  name: string
  slug?: string | null
  category?: string | null
}

type ServicePhotoData = {
  src: string
  alt: string
  contain?: boolean
  roomExample?: boolean
}

const DEODORIZER_PHOTO = {
  src: '/images/services/carpet-deodorizer.jpeg',
  alt: 'Carpet deodorizer application equipment',
  contain: true,
}
const RESTORATION_PHOTO = {
  src: '/images/services/water-restoration.jpeg',
  alt: 'Water restoration and structural drying equipment',
}
const WATER_TREATMENT_PHOTO = {
  src: '/images/services/water-filtration.jpeg',
  alt: 'Whole-home water filtration system',
  contain: true,
}

const SERVICE_PHOTOS: Array<ServicePhotoData & { matches: RegExp }> = [
  { matches: /deodori[sz]/i, ...DEODORIZER_PHOTO },
  {
    matches: /low[\s-]+moisture|encapsulation|\blvm\b|\bvlm\b|bonnet/i,
    src: '/images/services/low-moisture-carpet-cleaning.jpg',
    alt: 'Low-moisture carpet cleaning',
    contain: true,
  },
  {
    matches: /commercial[\s-]+carpet/i,
    src: '/images/services/commercial-carpet-cleaning.webp',
    alt: 'Commercial carpet cleaning',
  },
  {
    matches: /wall.*tile|tile.*wall/i,
    src: '/images/services/wall-tile-cleaning.png',
    alt: 'Wall tile cleaning',
  },
  {
    matches: /tile.*grout|grout.*tile/i,
    src: '/images/services/floor-tile-cleaning.webp',
    alt: 'Floor tile and grout cleaning',
  },
  {
    matches: /\bstep(?:s)?\b|\bstairs?\b|\blanding\b/i,
    src: '/images/services/stair-carpet-cleaning.jpeg',
    alt: 'Stair carpet cleaning',
  },
  {
    matches: /\brugs?\b|\brunner\b/i,
    src: '/images/services/area-rug-cleaning.jpg',
    alt: 'Area rug cleaning',
  },
  {
    matches: /legendary/i,
    src: '/images/services/legendary-restoration-cleaning.jpeg',
    alt: 'Legendary Restoration carpet cleaning',
  },
  {
    matches:
      /\bsmall[\s-]+area\b|\bwalk[\s-]*in[\s-]+closet\b|hall-bathroom-closet-carpet-cleaning-30-to-100-sqft/i,
    src: '/images/services/residential-small-area-closet.jpg',
    alt: 'Small area example: carpeted walk-in closet (up to 100 sq ft)',
    roomExample: true,
  },
  {
    matches: /\bregular[\s-]+(?:size[\s-]+)?room\b/i,
    src: '/images/services/residential-regular-bedroom.jpg',
    alt: 'Regular room example: carpeted bedroom (100–200 sq ft)',
    roomExample: true,
  },
  {
    matches: /\bsasquatch[\s-]+(?:size[\s-]+)?(?:room|area)\b/i,
    src: '/images/services/residential-sasquatch-living-room.jpg',
    alt: 'Sasquatch size example: carpeted living room (200–400 sq ft)',
    roomExample: true,
  },
  {
    matches: /\bmonster[\s-]+(?:size[\s-]+)?(?:room|area)\b/i,
    src: '/images/services/residential-monster-basement.jpg',
    alt: 'Monster size example: carpeted basement (400–600 sq ft)',
    roomExample: true,
  },
  {
    matches:
      /\bjumbo[\s-]+(?:hum[ou]ngous[\s-]+)?(?:size[\s-]+)?(?:room|area)\b/i,
    src: '/images/services/residential-jumbo-walkout-basement.jpg',
    alt: 'Jumbo size example: carpeted walkout basement (600–800 sq ft)',
    roomExample: true,
  },
  {
    matches: /auto[\s-]*scrubb|floor[\s-]*scrubb/i,
    src: '/images/services/vinyl-lvt-floor-scrubbing.jpeg',
    alt: 'Vinyl and LVT floor scrubbing',
  },
  {
    matches:
      /upholstery|sofa|couch|love[\s-]*seat|recliner|dining[\s-]+chair|ottoman|sectional/i,
    src: '/images/services/upholstery-cleaning.jpg',
    alt: 'Upholstery cleaning',
  },
]

export function getServicePhoto(
  service: ServicePhotoIdentity,
): ServicePhotoData | undefined {
  const description = `${service.name} ${service.slug || ''} ${service.category || ''}`
  if (/leather|mattress/i.test(description)) return undefined
  const specialized =
    /legendary|restoration|commercial|low[\s-]+moisture|encapsulation|\b(?:lvm|vlm)\b|bonnet/i.test(
      description,
    )
  return SERVICE_PHOTOS.find(
    (entry) =>
      entry.matches.test(description) && (!entry.roomExample || !specialized),
  )
}

export function getServiceCategoryPhoto(
  category: string,
  services: ServicePhotoIdentity[],
) {
  const regularRoom = services.find(
    (service) =>
      service.slug === 'regular-size-room-100-to-200-sqft' ||
      /\bregular[\s-]+(?:size[\s-]+)?room\b/i.test(service.name),
  )
  return (
    (
      {
        'carpet deodorizer': DEODORIZER_PHOTO,
        restoration: RESTORATION_PHOTO,
        'water treatment': WATER_TREATMENT_PHOTO,
      } as Record<string, { src: string; alt: string; contain?: boolean }>
    )[category.trim().toLowerCase()] ??
    getServicePhoto({ name: category, category }) ??
    (regularRoom && getServicePhoto(regularRoom)) ??
    services.map((service) => getServicePhoto(service)).find(Boolean)
  )
}

type Relation<T> = T | T[] | null

export type InvoiceServiceLinks = {
  photo_service?: ServicePhotoIdentity | null
  service_catalog_items?: Relation<ServicePhotoIdentity>
  ops_appointment_line_items?: Relation<{
    service_catalog_items?: Relation<ServicePhotoIdentity>
  }>
}

function first<T>(relation: Relation<T> | undefined): T | undefined {
  return (Array.isArray(relation) ? relation[0] : relation) || undefined
}

export function invoiceCatalogService(
  item: InvoiceServiceLinks,
): ServicePhotoIdentity | undefined {
  return (
    item.photo_service ||
    first(item.service_catalog_items) ||
    first(first(item.ops_appointment_line_items)?.service_catalog_items)
  )
}

export function invoicePhotoService(
  item: InvoiceServiceLinks & { description: string },
): ServicePhotoIdentity {
  return invoiceCatalogService(item) || { name: item.description }
}
