// Repair after the first cron run:
//   John (#1014) and Lindsey (#1005) were already created in QB (TxnId 5278
//     and 5279). Second run queued them again; just restore the QB link and
//     mark synced — no second QB call needed.
//   Pam (#1004) and Stephanie (#1003) hit DocNumber collisions with ancient
//     QB invoices that used those numbers years ago. Bump them to fresh
//     numbers above QB's last-used doc number so they can be created.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

async function restore(invoiceId, qbInvoiceId, name) {
  await s
    .from('ops_invoices')
    .update({
      quickbooks_invoice_id: qbInvoiceId,
      sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
  await s
    .from('ops_quickbooks_sync_jobs')
    .delete()
    .eq('entity_type', 'invoice')
    .eq('entity_id', invoiceId)
  console.log(`  ✅ ${name}: relinked to QB ${qbInvoiceId}, cleared pending jobs`)
}

// --- Step 1: restore John + Lindsey ---
console.log('Restoring John + Lindsey QB links...')
await restore('7d64a7cf-5fb7-4674-a2a7-ebb728c86a53', '5278', 'John Mosiman')
await restore('6b7e946a-6ddb-46dd-9b58-6476a738b433', '5279', 'Lindsey Wright')

// --- Step 2: bump Pam + Stephanie invoice_number to fresh values ---
// QB has used up to 1014 in our own runs (John's). Lindsey is 1005 (maps to
// TxnId 5279). We also collide with pre-existing QB invoices at 1003 and 1004.
// Safest: jump well above QB's internal TxnId range; use 6000-series for
// these two specifically, then advance our sequence to keep things in order.
const PAM_ID = 'c5c36ad5-26e6-41c0-b0a0-5bfa3ee37e8b'
const STEPH_ID = '27317403-9100-4535-b0c9-d7a82128294a'

console.log('\nReassigning Pam invoice_number -> 6001...')
await s.from('ops_invoices').update({ invoice_number: 6001 }).eq('id', PAM_ID)

console.log('Reassigning Stephanie invoice_number -> 6002...')
await s
  .from('ops_invoices')
  .update({ invoice_number: 6002 })
  .eq('id', STEPH_ID)

// Advance the sequence past 6002 so future invoices don't collide
const { error: seqErr } = await s.rpc('exec_sql', {
  sql: "SELECT setval('sasquatch_invoice_number_seq', 6002, true)",
})
if (seqErr) {
  console.log(
    `(note: could not advance sequence via RPC — ${seqErr.message}. Run manually: SELECT setval('sasquatch_invoice_number_seq', 6002, true);)`,
  )
}

// Clear QB link + sync job and requeue
for (const [id, name] of [
  [PAM_ID, 'Pam'],
  [STEPH_ID, 'Stephanie'],
]) {
  await s
    .from('ops_invoices')
    .update({
      quickbooks_invoice_id: null,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  await s
    .from('ops_quickbooks_sync_jobs')
    .delete()
    .eq('entity_type', 'invoice')
    .eq('entity_id', id)

  const { data: appt } = await s
    .from('ops_appointments')
    .select('appointment_date, customer_id')
    .eq(
      'id',
      id === PAM_ID
        ? '3d463e50-d792-45ed-a4f3-632760e1e89c'
        : 'ce623059-05b0-4ccd-98f6-7baf0a7552d8',
    )
    .single()

  await s.from('ops_quickbooks_sync_jobs').insert({
    entity_type: 'invoice',
    entity_id: id,
    status: 'pending',
    payload: {
      invoice_id: id,
      customer_id: appt.customer_id,
      service_date: appt.appointment_date,
    },
  })
  console.log(`  Requeued ${name} with fresh invoice number`)
}

console.log('\n✅ Repair complete. Run the cron again to push Pam + Stephanie.')
