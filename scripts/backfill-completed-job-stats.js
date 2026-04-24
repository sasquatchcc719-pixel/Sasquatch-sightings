/**
 * Backfill revenue_entries for completed ops appointments that were never
 * recorded via "Finish & close job". Safe to run multiple times — skips any
 * appointment whose invoice already has a revenue_entries row.
 *
 * Usage:
 *   node scripts/backfill-completed-job-stats.js
 *
 * Optional: filter to a specific customer name (e.g. Recovery Village):
 *   node scripts/backfill-completed-job-stats.js "Recovery Village"
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const customerFilter = process.argv[2] || null

async function main() {
  console.log('Fetching completed appointments...')
  if (customerFilter) {
    console.log(
      `  → Filtering by customer name containing: "${customerFilter}"`,
    )
  }

  // Pull all completed appointments with their invoices and customer name
  const { data: appointments, error: apptErr } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      appointment_date,
      start_time,
      end_time,
      on_my_way_at,
      completed_at,
      quoted_total,
      assigned_staff_user_id,
      ops_customers!ops_appointments_customer_id_fkey (
        id,
        full_name,
        business_name
      ),
      ops_invoices (
        id,
        total,
        status,
        ops_invoice_line_items (
          line_total
        )
      ),
      ops_appointment_line_items (
        name_snapshot
      )
    `,
    )
    .eq('status', 'completed')
    .order('appointment_date', { ascending: true })

  if (apptErr) {
    console.error('Failed to fetch appointments:', apptErr)
    process.exit(1)
  }

  console.log(`Found ${appointments.length} completed appointments total.`)

  // Filter by customer name if requested
  let targets = appointments
  if (customerFilter) {
    const lower = customerFilter.toLowerCase()
    targets = appointments.filter((a) => {
      const cust = Array.isArray(a.ops_customers)
        ? a.ops_customers[0]
        : a.ops_customers
      if (!cust) return false
      const name = (cust.business_name || cust.full_name || '').toLowerCase()
      return name.includes(lower)
    })
    console.log(`  → ${targets.length} match "${customerFilter}"`)
  }

  // For each appointment, check if the invoice already has a revenue_entries row
  let skipped = 0
  let created = 0
  let noInvoice = 0
  let errors = 0

  for (const appt of targets) {
    const invoice = Array.isArray(appt.ops_invoices)
      ? appt.ops_invoices[0]
      : appt.ops_invoices
    const cust = Array.isArray(appt.ops_customers)
      ? appt.ops_customers[0]
      : appt.ops_customers
    const custName = cust?.business_name || cust?.full_name || 'Unknown'

    if (!invoice?.id) {
      console.log(`  SKIP (no invoice)  ${appt.appointment_date}  ${custName}`)
      noInvoice++
      continue
    }

    // Check for existing revenue_entries row
    const { data: existing } = await supabase
      .from('revenue_entries')
      .select('id')
      .eq('ops_invoice_id', invoice.id)
      .maybeSingle()

    if (existing?.id) {
      skipped++
      continue
    }

    // Calculate invoice amount
    const invLines = Array.isArray(invoice.ops_invoice_line_items)
      ? invoice.ops_invoice_line_items
      : invoice.ops_invoice_line_items
        ? [invoice.ops_invoice_line_items]
        : []
    const lineTotal = invLines.reduce(
      (sum, l) => sum + (Number(l.line_total) || 0),
      0,
    )
    const invoiceTotal =
      lineTotal > 0
        ? lineTotal
        : Number(invoice.total || appt.quoted_total || 0)

    // Calculate hours worked
    let hoursWorked = 0
    if (appt.on_my_way_at && appt.completed_at) {
      const ms = new Date(appt.completed_at) - new Date(appt.on_my_way_at)
      hoursWorked = Math.max(0, ms / (1000 * 60 * 60))
    } else if (appt.start_time && appt.end_time) {
      const [sh, sm] = appt.start_time.split(':').map(Number)
      const [eh, em] = appt.end_time.split(':').map(Number)
      hoursWorked = Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60)
    }

    // Build description from line items
    const lineItems = Array.isArray(appt.ops_appointment_line_items)
      ? appt.ops_appointment_line_items
      : appt.ops_appointment_line_items
        ? [appt.ops_appointment_line_items]
        : []
    const description =
      lineItems
        .map((l) => l.name_snapshot)
        .filter(Boolean)
        .join(', ') || 'Ops job'

    // Determine user_id — use assigned staff or fall back to first admin
    let userId = appt.assigned_staff_user_id
    if (!userId) {
      const { data: adminUser } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('role', ['owner', 'admin'])
        .limit(1)
        .single()
      userId = adminUser?.user_id
    }

    if (!userId) {
      console.error(
        `  ERROR  ${appt.appointment_date}  ${custName}  — no user_id found`,
      )
      errors++
      continue
    }

    const { error: insertErr } = await supabase.from('revenue_entries').insert({
      user_id: userId,
      entry_date:
        appt.appointment_date || new Date().toISOString().split('T')[0],
      description,
      invoice_amount: invoiceTotal,
      hours_worked: hoursWorked,
      ops_invoice_id: invoice.id,
    })

    if (insertErr) {
      console.error(
        `  ERROR  ${appt.appointment_date}  ${custName}:`,
        insertErr.message,
      )
      errors++
    } else {
      console.log(
        `  CREATED  ${appt.appointment_date}  ${custName}  $${invoiceTotal.toFixed(2)}  ${hoursWorked.toFixed(2)}h`,
      )
      created++
    }
  }

  console.log('\n─────────────────────────────────')
  console.log(`Created:    ${created}`)
  console.log(`Skipped:    ${skipped} (already had stats)`)
  console.log(`No invoice: ${noInvoice}`)
  console.log(`Errors:     ${errors}`)
  console.log('─────────────────────────────────')
  console.log('Done.')
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
