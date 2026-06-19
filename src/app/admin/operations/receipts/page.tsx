import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { getQuickbooksReceiptEmail } from '@/lib/ops/tech-receipts'
import {
  ReceiptsAdmin,
  type AdminReceipt,
} from '@/components/admin/ops/receipts-admin'

export default async function OperationsReceiptsPage() {
  await requireAnyRole(['admin', 'owner'])
  const supabase = createAdminClient()

  const qbEmail = await getQuickbooksReceiptEmail(supabase)
  const fromEmail =
    process.env.OPS_EMAIL_FROM ||
    'Sasquatch Carpet Cleaning <onboarding@resend.dev>'

  const { data } = await supabase
    .from('ops_tech_receipts')
    .select(
      'id, public_url, submitted_by_name, amount, note, category, status, error_message, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <ReceiptsAdmin
      initialEmail={qbEmail ?? ''}
      fromEmail={fromEmail}
      receipts={(data as AdminReceipt[] | null) ?? []}
    />
  )
}
