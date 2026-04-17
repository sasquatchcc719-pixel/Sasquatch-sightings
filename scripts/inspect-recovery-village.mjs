import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const { data: customers } = await s
  .from('ops_customers')
  .select('id, full_name, business_name, quickbooks_customer_id')
  .or('full_name.ilike.%recovery village%,business_name.ilike.%recovery village%')

console.log('Recovery Village customer(s):')
for (const c of customers || []) {
  console.log(
    `  ${c.full_name || c.business_name} | id=${c.id} | qb=${c.quickbooks_customer_id || 'none'}`,
  )

  // Templates
  const { data: templates } = await s
    .from('ops_recurring_templates')
    .select('id, label, invoice_mode, is_active, line_items, discount_amount')
    .eq('customer_id', c.id)
  console.log(`\n  Templates: ${templates?.length || 0}`)
  for (const t of templates || []) {
    console.log(
      `    - "${t.label}" | mode=${t.invoice_mode} | active=${t.is_active}`,
    )
    for (const li of t.line_items || []) {
      console.log(
        `        • ${li.name_snapshot} | qty=${li.quantity} @ $${li.unit_price}`,
      )
    }
  }

  // Appointments this month
  const monthStart = '2026-04-01'
  const { data: appts } = await s
    .from('ops_appointments')
    .select(
      'id, appointment_date, status, quoted_total, ops_appointment_line_items(name_snapshot, quantity, unit_price, line_total)',
    )
    .eq('customer_id', c.id)
    .gte('appointment_date', monthStart)
    .order('appointment_date')
  console.log(`\n  Appointments from ${monthStart}:`)
  for (const a of appts || []) {
    const lines = a.ops_appointment_line_items || []
    const sum = lines.reduce((x, l) => x + Number(l.line_total || 0), 0)
    console.log(
      `    ${a.appointment_date} | status=${a.status} | quote=$${a.quoted_total} | lines sum=$${sum}`,
    )
  }

  // Batch invoices
  const { data: batches } = await s
    .from('ops_batch_invoices')
    .select(
      'id, month, status, subtotal, total, invoice_number, quickbooks_invoice_id, sync_status',
    )
    .eq('customer_id', c.id)
    .order('month', { ascending: false })
  console.log(`\n  Batch invoices: ${batches?.length || 0}`)
  for (const b of batches || []) {
    console.log(
      `    month=${b.month} | #${b.invoice_number || '—'} | total=$${b.total} | status=${b.status} | qb=${b.quickbooks_invoice_id || '—'} | sync=${b.sync_status}`,
    )
  }

  // Per-visit invoices (if any exist — would be wrong for this customer)
  const apptIds = (appts || []).map((a) => a.id)
  if (apptIds.length) {
    const { data: invs } = await s
      .from('ops_invoices')
      .select(
        'id, appointment_id, status, total, invoice_number, quickbooks_invoice_id',
      )
      .in('appointment_id', apptIds)
    console.log(
      `\n  Per-visit invoices (should be 0 if batch_monthly): ${invs?.length || 0}`,
    )
    for (const i of invs || []) {
      console.log(
        `    #${i.invoice_number || '—'} | total=$${i.total} | status=${i.status} | qb=${i.quickbooks_invoice_id || '—'}`,
      )
    }
  }
}
