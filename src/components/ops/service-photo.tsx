import Image from 'next/image'

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
    matches:
      /upholstery|sofa|couch|love[\s-]*seat|recliner|dining[\s-]+chair|ottoman|sectional/i,
    src: '/images/services/upholstery-cleaning.jpg',
    alt: 'Upholstery cleaning',
  },
]

export function ServicePhoto({
  name,
  slug,
  category,
}: {
  name: string
  slug?: string | null
  category?: string | null
}) {
  if (/leather|mattress/i.test(name)) return null
  const description = `${name} ${slug || ''} ${category || ''}`
  const photo = SERVICE_PHOTOS.find((entry) => entry.matches.test(description))
  if (!photo) return null

  return (
    <a
      href={photo.src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View ${photo.alt.toLowerCase()} photo`}
      title="View larger photo"
      className="focus-visible:ring-ring shrink-0 rounded-md focus-visible:ring-2"
    >
      <Image
        src={photo.src}
        alt={photo.alt}
        width={40}
        height={40}
        className={`h-10 w-10 shrink-0 rounded-md border ${photo.contain ? 'bg-white object-contain' : 'object-cover'}`}
      />
    </a>
  )
}
