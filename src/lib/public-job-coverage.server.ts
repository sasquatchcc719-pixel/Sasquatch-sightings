import { loadCustomerValueIndex } from '@/lib/ops/business-health'
import {
  buildHistoricalJobPins,
  type HistoricalJobPin,
  type HistoricalServiceAddress,
} from '@/lib/public-job-coverage'
import { createAdminClient } from '@/supabase/server'

type PublishedJobRecord = {
  gps_lat: number | string | null
  gps_lng: number | string | null
  ops_invoice_id: string | null
}

export async function loadHistoricalJobPins(
  publishedJobs: PublishedJobRecord[],
): Promise<HistoricalJobPin[]> {
  const supabase = createAdminClient()
  const invoiceIds = publishedJobs
    .map((job) => job.ops_invoice_id)
    .filter((id): id is string => !!id)

  const [historyIndex, addressesResult, invoicesResult] = await Promise.all([
    loadCustomerValueIndex(supabase),
    supabase
      .from('ops_service_addresses')
      .select(
        'id, customer_id, street_1, city, state, zip_code, latitude, longitude, geocode_source',
      )
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .limit(2000),
    invoiceIds.length > 0
      ? supabase
          .from('ops_invoices')
          .select('id, appointment_id')
          .in('id', invoiceIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (addressesResult.error) throw addressesResult.error
  if (invoicesResult.error) throw invoicesResult.error

  const appointmentIds = (invoicesResult.data || [])
    .map((invoice) => invoice.appointment_id)
    .filter((id): id is string => !!id)
  const appointmentsResult =
    appointmentIds.length > 0
      ? await supabase
          .from('ops_appointments')
          .select('id, service_address_id')
          .in('id', appointmentIds)
      : { data: [], error: null }

  if (appointmentsResult.error) throw appointmentsResult.error

  const appointmentIdByInvoiceId = new Map(
    (invoicesResult.data || []).map((invoice) => [
      invoice.id,
      invoice.appointment_id,
    ]),
  )
  const addressIdByAppointmentId = new Map(
    (appointmentsResult.data || []).map((appointment) => [
      appointment.id,
      appointment.service_address_id,
    ]),
  )

  return buildHistoricalJobPins({
    addresses: (addressesResult.data || []) as HistoricalServiceAddress[],
    customerIdsWithJobHistory: new Set(historyIndex.keys()),
    publishedJobs: publishedJobs.map((job) => ({
      gps_lat: job.gps_lat,
      gps_lng: job.gps_lng,
      represented_address_id: job.ops_invoice_id
        ? addressIdByAppointmentId.get(
            appointmentIdByInvoiceId.get(job.ops_invoice_id) || '',
          ) || null
        : null,
    })),
  })
}
