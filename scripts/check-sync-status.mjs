import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const INVOICE_IDS = [
  'c5c36ad5-26e6-41c0-b0a0-5bfa3ee37e8b', // Pam
  '27317403-9100-4535-b0c9-d7a82128294a', // Stephanie
  '7d64a7cf-5fb7-4674-a2a7-ebb728c86a53', // John
  '6b7e946a-6ddb-46dd-9b58-6476a738b433', // Lindsey
]
const NAMES = ['Pam', 'Stephanie', 'John', 'Lindsey']

for (let i = 0; i < INVOICE_IDS.length; i++) {
  const { data: inv } = await s
    .from('ops_invoices')
    .select('id, invoice_number, total, status, sync_status, quickbooks_invoice_id')
    .eq('id', INVOICE_IDS[i])
    .single()
  console.log(`${NAMES[i]}: #${inv.invoice_number} $${inv.total} sync=${inv.sync_status} qb=${inv.quickbooks_invoice_id || '—'}`)

  const { data: jobs } = await s
    .from('ops_quickbooks_sync_jobs')
    .select('id, status, error_message, created_at')
    .eq('entity_type', 'invoice')
    .eq('entity_id', INVOICE_IDS[i])
    .order('created_at', { ascending: false })
    .limit(3)
  for (const j of jobs || []) {
    console.log(`   job ${j.id.slice(0,8)} status=${j.status} err=${j.error_message || 'ok'}`)
  }
}
