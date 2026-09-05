'use client'

import { ClientCommercialDetails } from '@/components/client/commercial-details'
import type { CommercialData } from '@/lib/ops/commercial'
import type { ClientPortalData } from '@/lib/ops/client-portal'

export function CommercialClientPreview({
  commercial,
  schedule,
}: {
  commercial: CommercialData
  schedule: ClientPortalData
}) {
  return (
    <>
      <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-50">
        <strong>Customer preview:</strong> review the published agreement,
        services, business profile, and schedule exactly as the customer will
        see them. Signing, profile changes, and agreement notes are disabled in
        staff preview. Create the customer’s login under “Portal contacts &amp;
        signing access” when the agreement is ready.
      </div>
      <ClientCommercialDetails
        initialData={commercial}
        schedule={schedule}
        readOnly
      />
    </>
  )
}
