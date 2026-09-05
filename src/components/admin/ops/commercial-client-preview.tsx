'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ClientCommercialDetails } from '@/components/client/commercial-details'
import { RequestForm } from '@/components/client/client-portal'
import type { CommercialData } from '@/lib/ops/commercial'
import type { ClientPortalData } from '@/lib/ops/client-portal'
import {
  useCommercialTestRequests,
  type TestRequest,
} from './use-commercial-test-requests'

export function CommercialClientPreview({
  commercial,
  schedule,
  customerId,
}: {
  commercial: CommercialData
  schedule: ClientPortalData
  customerId: string
}) {
  const [request, setRequest] = useState<{
    service: string
    key: number
  } | null>(null)
  const { records, add, resolve, clear, error } =
    useCommercialTestRequests(customerId)

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

  function saveTestRequest(request: {
    request_type: string
    message: string
    details: Record<string, string>
    appointment_id: string | null
  }) {
    add({
      customer_id: customerId,
      business_name: commercial.businessName,
      ...request,
    })
  }

  return (
    <>
      <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-50">
        <strong>Customer test drive:</strong> review published agreements and
        try the service-request form, including frequency and preferred dates.
        Signing and profile changes are disabled here. Nothing entered here is
        sent to production; submitted test requests are saved only in this
        browser for seven days. When you are ready, return to the account and
        create the customer’s portal login under “Portal contacts &amp; signing
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
            onPreviewSubmitted={saveTestRequest}
          />
        </section>
      )}
      <TestRequestReceipt
        records={records}
        error={error}
        onResolve={resolve}
        onClear={() => clear()}
      />
    </>
  )
}

function TestRequestReceipt({
  records,
  error,
  onResolve,
  onClear,
}: {
  records: TestRequest[]
  error: string
  onResolve: (id: string, status: TestRequest['status'], notes?: string) => void
  onClear: () => void
}) {
  return (
    <section className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-amber-200 uppercase">
            Browser-only test records
          </p>
          <h2 className="mt-1 text-xl font-semibold">Your request receipt</h2>
          <p className="mt-1 text-sm text-amber-50/80">
            This is the handoff a real customer would see. Records stay in this
            browser for 7 days and never create a job, invoice, or Telegram
            alert.
          </p>
        </div>
        {records.length > 0 && (
          <button
            className="text-sm text-amber-100 underline"
            onClick={onClear}
            type="button"
          >
            Clear test records
          </button>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-200">{error}</p>}
      {records.length === 0 ? (
        <p className="mt-4 text-sm text-amber-50/75">
          Submit the form above once to see the request ID, details, status, and
          staff reply here.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {records.map((record) => (
            <div
              key={record.id}
              className="rounded-xl border border-amber-200/20 bg-slate-950/40 p-4"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-full bg-amber-200/20 px-2 py-0.5 text-xs font-semibold text-amber-100">
                  TEST
                </span>
                <span className="font-medium">
                  Request {record.id.slice(0, 15)}
                </span>
                <span className="ml-auto text-xs text-amber-50/70">
                  {record.status}
                </span>
              </div>
              <p className="mt-2 text-sm">{record.message}</p>
              {Object.entries(record.details)
                .filter(([, value]) => value)
                .map(([key, value]) => (
                  <p key={key} className="mt-1 text-xs text-amber-50/70">
                    {key.replaceAll('_', ' ')}: {value}
                  </p>
                ))}
              {record.admin_notes && (
                <p className="mt-2 text-sm text-emerald-200">
                  Staff reply: {record.admin_notes}
                </p>
              )}
              {record.status === 'pending' && (
                <button
                  className="mt-3 rounded-lg border border-amber-200/30 px-3 py-1.5 text-xs text-amber-50"
                  type="button"
                  onClick={() =>
                    onResolve(
                      record.id,
                      'approved',
                      'Approved in the staff test drive. Awaiting scheduling.',
                    )
                  }
                >
                  Approve in test drive
                </button>
              )}
              {record.status === 'approved' && (
                <p className="mt-2 text-xs text-amber-50/70">
                  Approved — awaiting the actual schedule, just like a real
                  request.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
