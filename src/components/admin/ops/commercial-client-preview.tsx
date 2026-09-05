'use client'

import { ClientPortal } from '@/components/client/client-portal'
import { lineAmount, type CommercialData } from '@/lib/ops/commercial'
import type { ClientPortalData } from '@/lib/ops/client-portal'

export function CommercialClientPreview({
  commercial,
  schedule,
  sampleDate,
}: {
  commercial: CommercialData
  schedule: ClientPortalData
  sampleDate: string
}) {
  const agreement = commercial.agreements.find(
    (item) => item.status === 'published' || item.status === 'signed',
  )
  const service = agreement?.content.lines.find(
    (line) => line.phase !== 'optional',
  )
  const serviceName = service?.name || 'Commercial carpet maintenance'
  const quantity = service?.quantity || 2258
  const unitPrice = service?.unit_price || 0.28
  const total = service ? lineAmount(service) : quantity * unitPrice
  const showingExample = schedule.appointments.length === 0
  const exampleTemplateId = schedule.templates[0]?.id || 'preview-template'
  const previewSchedule: ClientPortalData = showingExample
    ? {
        ...schedule,
        templates:
          schedule.templates.length > 0
            ? schedule.templates
            : [
                {
                  id: exampleTemplateId,
                  label: 'Example monthly maintenance plan',
                  start_time: '18:00',
                  is_active: true,
                  schedule: ['Monthly on the 2nd Tuesday'],
                  lineItems: [
                    {
                      name: serviceName,
                      notes: service?.notes || null,
                      quantity,
                      unitPrice,
                    },
                  ],
                  discount: 0,
                  total,
                  address: commercial.addresses[0]
                    ? [
                        commercial.addresses[0].label,
                        commercial.addresses[0].street_1,
                        commercial.addresses[0].city,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : null,
                },
              ],
        appointments: [
          {
            id: 'preview-appointment',
            appointment_date: sampleDate,
            start_time: '18:00',
            end_time: '20:00',
            status: 'confirmed',
            client_note: 'Please check in with the manager when you arrive.',
            recurring_template_id: exampleTemplateId,
            template_label:
              schedule.templates[0]?.label ||
              'Example monthly maintenance plan',
            line_items: [
              {
                id: 'preview-line-item',
                name_snapshot: serviceName,
                quantity,
                unit_price: unitPrice,
                line_total: total,
                duration_minutes: 120,
                notes: service?.notes || null,
              },
            ],
          },
        ],
      }
    : schedule

  return (
    <>
      <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-50">
        <strong>Customer preview:</strong> use the Agreement and Appointments
        tabs exactly as the customer will. Signing, profile changes, appointment
        notes, and agreement notes are disabled here.
        {showingExample && (
          <span className="mt-2 block font-medium text-amber-200">
            The Appointments tab contains one clearly labeled preview example
            because this account has no scheduled visits. Nothing was added to
            the real calendar.
          </span>
        )}
      </div>
      <ClientPortal
        businessName={commercial.businessName}
        managerName="Customer preview"
        initialData={previewSchedule}
        initialCommercialData={commercial}
        mustChangePassword={false}
        canSign={false}
        readOnly
      />
    </>
  )
}
