'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import {
  formatServiceAddress,
  streetViewSrc,
  type ServiceAddressLike,
} from '@/lib/ops/address-links'

/**
 * Photo of the house, so you know which driveway is yours before you arrive.
 *
 * Owns its own failure state: not every address has Street View coverage, and a
 * broken image is worse than no panel. Previously this flag was hoisted into the
 * parent screen for no reason.
 */
export function StreetViewCard({ address }: { address: ServiceAddressLike | null }) {
  const [failed, setFailed] = useState(false)

  if (!address || failed) return null

  const addressText = formatServiceAddress(address)

  return (
    <Card className="border-border/60 overflow-hidden shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={streetViewSrc(addressText)}
        alt={`Street view of ${address.street_1 ?? 'the service address'}`}
        className="w-full object-cover"
        style={{ height: '200px' }}
        onError={() => setFailed(true)}
      />
      <div className="bg-muted/40 text-muted-foreground px-4 py-2 text-xs">
        Street View · {address.street_1}, {address.city}
      </div>
    </Card>
  )
}
