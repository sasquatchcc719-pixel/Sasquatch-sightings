export const PAYMENT_TEXT_TYPES = [
  'square_payment_link',
  'venmo_payment_link',
  'payment_link',
  'invoice_send',
] as const

export type PaymentTextType = (typeof PAYMENT_TEXT_TYPES)[number]

export type PaymentTextSend = {
  id: string
  message_type: string
  recipient_phone: string
  status: string | null
  twilio_sid: string | null
  sent_at: string
  sent_by: string | null
}

export const PAYMENT_TEXT_TYPE_LABELS: Record<PaymentTextType, string> = {
  square_payment_link: 'Square Pay',
  venmo_payment_link: 'Venmo Pay',
  payment_link: 'QuickBooks Pay',
  invoice_send: 'Invoice text',
}

export function isPaymentTextType(value: string): value is PaymentTextType {
  return (PAYMENT_TEXT_TYPES as readonly string[]).includes(value)
}

export function paymentTextTypeLabel(type: string): string {
  return isPaymentTextType(type) ? PAYMENT_TEXT_TYPE_LABELS[type] : type
}

export function formatPaymentTextStamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatPaymentTextPhone(
  phone: string | null | undefined,
): string {
  const digits = String(phone || '').replace(/\D/g, '')
  const last10 = digits.length >= 10 ? digits.slice(-10) : ''
  if (!last10) return String(phone || '').trim()
  return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`
}

export function lastPaymentText(
  sends: PaymentTextSend[],
  type: PaymentTextType,
): PaymentTextSend | null {
  return sends.find((send) => send.message_type === type) ?? null
}

export function paymentTextSenderName(access: {
  email?: string | null
  staff?: { display_name?: string | null } | null
}): string {
  const staffName = access.staff?.display_name?.trim()
  if (staffName) return staffName
  return access.email?.trim() || 'Staff'
}
