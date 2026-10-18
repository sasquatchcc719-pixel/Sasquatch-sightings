import Image from 'next/image'
import { getServicePhoto } from '@/lib/ops/service-photos'

export function ServicePhoto({
  name,
  slug,
  category,
}: {
  name: string
  slug?: string | null
  category?: string | null
}) {
  const photo = getServicePhoto({ name, slug, category })
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
