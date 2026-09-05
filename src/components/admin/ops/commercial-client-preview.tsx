'use client'

import { useState } from 'react'
import { ClientCommercialDetails } from '@/components/client/commercial-details'
import { RequestForm } from '@/components/client/client-portal'
import type { CommercialData } from '@/lib/ops/commercial'
import type { ClientPortalData } from '@/lib/ops/client-portal'

export function CommercialClientPreview({
  commercial,
  schedule,
}: {
  commercial: CommercialData
  schedule: ClientPortalData
}) {
  const [request, setRequest] = useState<{
    service: string
    key: number
  } | null>(null)

  function previewRequest(service: string) {
    setRequest({ service, key: Date.now() })
    requestAnimationFrame(() =>
      document.getElementById('preview-service-request')?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      }),
    )
  }

  return (
    <>
      <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-50">
        <strong>Customer test drive:</strong> open agreements and
        service-request forms exactly as the customer will see them. Nothing
        entered here is saved or sent. When you are ready, return to the account
        and create her portal login under “Portal contacts &amp; signing
        access.”
      </div>
      <ClientCommercialDetails
        initialData={commercial}
        schedule={schedule}
        readOnly
        previewServiceRequests
        onRequestService={previewRequest}
      />
      {request && (
        <section
          id="preview-service-request"
          className="scroll-mt-6 rounded-2xl border border-cyan-400/30 bg-slate-950/50 p-2"
        >
          <RequestForm
            key={request.key}
            initialService={request.service}
            appointments={schedule.appointments}
            preview
          />
        </section>
      )}
    </>
  )
}
