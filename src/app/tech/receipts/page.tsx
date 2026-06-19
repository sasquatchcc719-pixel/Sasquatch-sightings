import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  TechReceiptCapture,
  type TechReceipt,
} from '@/components/tech/tech-receipt-capture'

export default async function TechReceiptsPage() {
  const access = await requireAnyRole(['admin', 'owner', 'tech'])
  const supabase = createAdminClient()
  const staffUserId = access.staff?.id ?? null

  let receipts: TechReceipt[] = []
  if (staffUserId) {
    const { data } = await supabase
      .from('ops_tech_receipts')
      .select(
        'id, public_url, amount, note, category, status, error_message, created_at',
      )
      .eq('staff_user_id', staffUserId)
      .order('created_at', { ascending: false })
      .limit(25)
    receipts = (data as TechReceipt[] | null) ?? []
  }

  return <TechReceiptCapture initialReceipts={receipts} />
}
