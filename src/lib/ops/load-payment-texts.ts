import { createAdminClient } from '@/supabase/server'
import {
  PAYMENT_TEXT_TYPES,
  type PaymentTextSend,
} from '@/lib/ops/payment-texts'

type AdminClient = ReturnType<typeof createAdminClient>

export async function loadInvoicePaymentTexts(
  supabase: AdminClient,
  invoiceId: string | null | undefined,
): Promise<PaymentTextSend[]> {
  if (!invoiceId) return []

  const { data, error } = await supabase
    .from('sms_logs')
    .select(
      'id, message_type, recipient_phone, status, twilio_sid, sent_at, sent_by',
    )
    .eq('invoice_id', invoiceId)
    .in('message_type', [...PAYMENT_TEXT_TYPES])
    .order('sent_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[payment-texts] Failed to load invoice send history:', error)
    return []
  }

  return (data ?? []) as PaymentTextSend[]
}
