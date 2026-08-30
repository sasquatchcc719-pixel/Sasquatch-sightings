'use client'

import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  appleDirectionsHref,
  formatServiceAddress,
  googleDirectionsHref,
  type ServiceAddressLike,
} from '@/lib/ops/address-links'

/**
 * The Google / Apple directions pair from the job screens. Charles uses these
 * constantly on the way to a job, so they stay big, high-contrast, and thumb-sized.
 */
export function DirectionsButtons({ address }: { address: ServiceAddressLike }) {
  const addressText = formatServiceAddress(address)

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        size="default"
        className="w-full gap-2 bg-green-600 font-bold tracking-widest text-white uppercase hover:bg-green-500"
        asChild
      >
        <a
          href={googleDirectionsHref(addressText)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MapPin className="h-4 w-4" />
          Google Maps
        </a>
      </Button>
      <Button
        size="default"
        className="w-full gap-2 bg-sky-600 font-bold tracking-widest text-white uppercase hover:bg-sky-500"
        asChild
      >
        <a
          href={appleDirectionsHref(addressText)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MapPin className="h-4 w-4" />
          Apple Maps
        </a>
      </Button>
    </div>
  )
}
