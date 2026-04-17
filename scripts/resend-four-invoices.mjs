// Rebuilds the four corrected invoices locally and marks them pending sync.
// The production QuickBooks cron picks them up, creates the QB invoices as
// UNPAID with the sequential DocNumber assigned by our invoice_number trigger.
//
// Customer then goes to QuickBooks → Receive Payment, and applies the
// credit from their voided original invoice to the new clean invoice.
//
// Safe to re-run: updates existing invoices in place, never duplicates.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const JOBS = [
  {
    name: 'Pam Lively',
    customerId: '51359ffe-4d6d-460f-bc0b-0613df1ba4f5',
    appointmentId: '3d463e50-d792-45ed-a4f3-632760e1e89c',
    qbCustomerId: '572',
    total: 669.0,
  },
  {
    name: 'Stephanie Be',
    customerId: 'b468c02c-7e55-41bb-afab-83c28f0561c4',
    appointmentId: 'ce623059-05b0-4ccd-98f6-7baf0a7552d8',
    qbCustomerId: '571',
    total: 515.0,
  },
  {
    name: 'John Mosiman',
    customerId: '487fa86c-46d0-4e0c-b9ae-0ffbcf210dfd',
    appointmentId: '8ddb01ec-ed17-4fe7-8f82-5a215c23c1f4',
    qbCustomerId: '578',
    total: 363.0,
  },
  {
    name: 'Lindsey Wright',
    customerId: 'dae81663-fac6-4603-98bf-36678957bbaf',
    appointmentId: '500c51a5-17f4-47ee-9a18-761c349a36a2',
    qbCustomerId: '573',
    total: 144.0,
  },
]

for (const job of JOBS) {
  console.log(`\n--- ${job.name} ($${job.total}) ---`)

  const { data: appt } = await supabase
    .from('ops_appointments')
    .select('appointment_date')
    .eq('id', job.appointmentId)
    .single()

  const { data: existing } = await supabase
    .from('ops_invoices')
    .select('id, invoice_number, quickbooks_invoice_id, status, sync_status')
    .eq('appointment_id', job.appointmentId)
    .maybeSingle()

  let invoiceId
  let invoiceNumber
  if (existing) {
    invoiceId = existing.id
    invoiceNumber = existing.invoice_number
    // Force-clear any stale QB link (user voided the old ones in QB) and
    // reset to "ready, unpaid, pending sync" with correct totals.
    await supabase
      .from('ops_invoices')
      .update({
        status: 'ready',
        payment_status: 'unpaid',
        payment_method: null,
        subtotal: job.total,
        total: job.total,
        discount_amount: 0,
        quickbooks_invoice_id: null,
        quickbooks_customer_id: job.qbCustomerId,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
    console.log(
      `  Updated existing invoice id=${invoiceId} #${invoiceNumber} (cleared QB link)`,
    )
  } else {
    const { data: inserted, error } = await supabase
      .from('ops_invoices')
      .insert({
        appointment_id: job.appointmentId,
        quickbooks_customer_id: job.qbCustomerId,
        status: 'ready',
        payment_status: 'unpaid',
        payment_method: null,
        subtotal: job.total,
        total: job.total,
        discount_amount: 0,
        sync_status: 'pending',
      })
      .select('id, invoice_number')
      .single()
    if (error) throw error
    invoiceId = inserted.id
    invoiceNumber = inserted.invoice_number
    console.log(`  Created invoice id=${invoiceId} #${invoiceNumber}`)
  }

  await supabase
    .from('ops_invoice_line_items')
    .delete()
    .eq('invoice_id', invoiceId)
  await supabase.from('ops_invoice_line_items').insert({
    invoice_id: invoiceId,
    description: `Carpet cleaning services — ${appt.appointment_date}`,
    quantity: 1,
    unit_price: job.total,
    line_total: job.total,
  })

  await supabase
    .from('ops_appointments')
    .update({ payment_status: 'unpaid' })
    .eq('id', job.appointmentId)

  // Clear any old invoice sync jobs for this invoice, then queue a fresh one
  await supabase
    .from('ops_quickbooks_sync_jobs')
    .delete()
    .eq('entity_type', 'invoice')
    .eq('entity_id', invoiceId)

  await supabase.from('ops_quickbooks_sync_jobs').insert({
    entity_type: 'invoice',
    entity_id: invoiceId,
    status: 'pending',
    payload: {
      invoice_id: invoiceId,
      customer_id: job.customerId,
      service_date: appt.appointment_date,
    },
  })
  console.log(`  Queued sync job — invoice #${invoiceNumber} → QB`)
}

console.log(
  '\n✅ Local records ready. Next step: trigger the QuickBooks cron to push these to QB.',
)
