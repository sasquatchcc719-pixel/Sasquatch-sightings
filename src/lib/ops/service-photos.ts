export type ServicePhotoIdentity = {
  name: string
  slug?: string | null
  category?: string | null
}

const SERVICE_PHOTOS = [
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

export function getServicePhoto(service: ServicePhotoIdentity) {
  const description = `${service.name} ${service.slug || ''} ${service.category || ''}`
  if (/leather|mattress/i.test(description)) return undefined
  return SERVICE_PHOTOS.find((entry) => entry.matches.test(description))
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
