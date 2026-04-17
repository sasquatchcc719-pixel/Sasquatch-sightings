// Preview exactly what a Recovery Village monthly batch invoice will look
// like in QuickBooks. This does NOT touch QB — it just reads the local data
// and prints the QB payload we WOULD send.
//
// Usage: node scripts/preview-recovery-village-invoice.mjs 2026-05
//   (defaults to current month if no arg given)
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const arg = process.argv[2] || new Date().toISOString().slice(0, 7)
const [yyyy, mm] = arg.split('-').map(Number)
const monthStart = `${yyyy}-${String(mm).padStart(2, '0')}-01`
const monthEnd = new Date(yyyy, mm, 0).toISOString().slice(0, 10)

console.log(`\n📅 Previewing Recovery Village batch invoice for ${yyyy}-${String(mm).padStart(2, '0')}`)
console.log(`Range: ${monthStart} → ${monthEnd}\n`)

const customerId = 'd0f1160c-c2af-4901-807c-b72907ae7898' // Recovery Village

// Grab ALL appointments in the month (both completed and booked, for preview)
const { data: appts } = await s
  .from('ops_appointments')
  .select(
    `
    id, appointment_date, status, quoted_total,
    ops_appointment_line_items (
      name_snapshot, quantity, unit_price, line_total
    )
  `,
  )
  .eq('customer_id', customerId)
  .gte('appointment_date', monthStart)
  .lte('appointment_date', monthEnd)
  .order('appointment_date')

if (!appts || appts.length === 0) {
  console.log('No appointments this month.')
  process.exit(0)
}

console.log(`Found ${appts.length} appointment(s) this month:\n`)

const qbLines = []
let subtotal = 0

for (const appt of appts) {
  const lines = appt.ops_appointment_line_items || []
  const apptSum = lines.reduce((n, l) => n + Number(l.line_total || 0), 0)
  subtotal += apptSum
  const statusTag = appt.status === 'completed' ? '✓' : ' '
  console.log(
    `${statusTag} ${appt.appointment_date} (${appt.status}, $${apptSum.toFixed(2)})`,
  )
  for (const l of lines) {
    console.log(
      `     • ${l.name_snapshot}  |  ${l.quantity} × $${l.unit_price} = $${Number(l.line_total).toFixed(2)}`,
    )
    qbLines.push({
      description: `${appt.appointment_date} — ${l.name_snapshot}`,
      quantity: l.quantity,
      unit_price: l.unit_price,
      line_total: Number(l.line_total),
    })
  }
}

console.log('\n────────────────────────────────────────────')
console.log('  THE QUICKBOOKS INVOICE WE WOULD SEND:')
console.log('────────────────────────────────────────────')
console.log(`  Customer:       Recovery Village (QB id 19)`)
console.log(`  Service date:   ${monthStart}  (first day of month)`)
console.log(`  DocNumber:      #<next in sequence, e.g. 6103>`)
console.log(`  Status:         Unpaid`)
console.log(`  Line items:     ${qbLines.length}`)
console.log('')
for (const l of qbLines) {
  console.log(
    `    ${l.description.padEnd(72)} | qty ${String(l.quantity).padStart(5)} @ $${String(l.unit_price).padStart(7)} = $${l.line_total.toFixed(2).padStart(9)}`,
  )
}
console.log('')
console.log(`  TOTAL:  $${subtotal.toFixed(2)}`)
console.log('────────────────────────────────────────────\n')
console.log(
  '(Only appointments marked "completed" (✓) would actually be rolled up when you run generateBatchInvoice — this preview shows everything for clarity.)',
)
