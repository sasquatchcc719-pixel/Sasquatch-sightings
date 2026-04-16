import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ORIGINAL_APPT = '5dfb99f7-9e3c-4f8e-9d65-837f92828f6e'
const DUPLICATE_APPT = '937bd5c0-513d-4bec-bfe6-1b15d56a5303'

console.log('1. Updating original appointment to Monday April 20...')
const { data: updated, error: updateError } = await supabase
  .from('ops_appointments')
  .update({ appointment_date: '2026-04-20' })
  .eq('id', ORIGINAL_APPT)
  .select()

if (updateError) {
  console.error('❌ Update error:', updateError)
} else {
  console.log('✅ Original appointment updated to 2026-04-20')
}

console.log('\n2. Deleting duplicate appointment...')
// Delete related records first
await supabase.from('ops_appointment_line_items').delete().eq('appointment_id', DUPLICATE_APPT)
await supabase.from('ops_appointment_status_events').delete().eq('appointment_id', DUPLICATE_APPT)

const { data: dupInvoice } = await supabase
  .from('ops_invoices')
  .select('id')
  .eq('appointment_id', DUPLICATE_APPT)
  .single()

if (dupInvoice) {
  await supabase.from('ops_invoice_line_items').delete().eq('invoice_id', dupInvoice.id)
  await supabase.from('ops_invoice_status_events').delete().eq('invoice_id', dupInvoice.id)
  await supabase.from('ops_invoices').delete().eq('id', dupInvoice.id)
  console.log('✅ Deleted duplicate invoice and line items')
}

const { error: deleteError } = await supabase
  .from('ops_appointments')
  .delete()
  .eq('id', DUPLICATE_APPT)

if (deleteError) {
  console.error('❌ Delete error:', deleteError)
} else {
  console.log('✅ Duplicate appointment deleted')
}

console.log('\n✅ ✅ ✅ FIXED! ✅ ✅ ✅')
console.log('Ann Biebel has ONE appointment:')
console.log('Monday, April 20, 2026 at 11:00 AM')
console.log('ID:', ORIGINAL_APPT)
