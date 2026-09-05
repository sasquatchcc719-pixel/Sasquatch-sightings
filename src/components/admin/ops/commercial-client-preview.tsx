'use client'

import { useState } from 'react'
import Link from 'next/link'
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
        <strong>Customer test drive:</strong> review published agreements and
        try the service-request form, including frequency and preferred dates.
        Signing and profile changes are disabled here. Nothing entered here is
        saved or sent. When you are ready, return to the account and create the
        customer’s portal login under “Portal contacts &amp; signing access.”
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
          <p className="px-5 pt-4 text-sm text-cyan-100">
            This test will not appear in the inbox or notify Charles. Real
            customer submissions appear in{' '}
            <Link
              className="underline"
              href="/admin/operations/commercial#client-requests"
            >
              Client requests
            </Link>{' '}
            and trigger a Telegram alert.
          </p>
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
