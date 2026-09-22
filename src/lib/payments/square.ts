export function formatSquareAmount(
  amount: number | string | null | undefined,
): string | null {
  const numericAmount = Number(amount)
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return null
  return numericAmount.toFixed(2)
}

function squareApiBaseUrl(): string {
  return process.env.SQUARE_ENVIRONMENT === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com'
}

type SquareOrderLike = {
  customer_note?: unknown
  line_items?: unknown
  reference_id?: unknown
}

function invoiceNumberFromText(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = value.match(/\binvoice\s*#\s*(\d+)\b/i)
  if (!match) return null
  const invoiceNumber = Number(match[1])
  return Number.isSafeInteger(invoiceNumber) && invoiceNumber > 0
    ? invoiceNumber
    : null
}

/**
 * Square POS orders created by Sightings carry `Invoice #12345` in a line-item
 * note. Hosted checkout orders put the same reference in the item name. Keep
 * the parser deliberately strict so an unrelated Square sale cannot be matched
 * to an operations invoice by amount alone.
 */
export function extractSquareOrderInvoiceNumber(order: unknown): number | null {
  if (!order || typeof order !== 'object') return null
  const record = order as SquareOrderLike
  const direct =
    invoiceNumberFromText(record.reference_id) ||
    invoiceNumberFromText(record.customer_note)
  if (direct) return direct

  if (!Array.isArray(record.line_items)) return null
  for (const value of record.line_items) {
    if (!value || typeof value !== 'object') continue
    const item = value as { name?: unknown; note?: unknown }
    const invoiceNumber =
      invoiceNumberFromText(item.note) || invoiceNumberFromText(item.name)
    if (invoiceNumber) return invoiceNumber
  }
  return null
}

export async function retrieveSquareOrderInvoiceNumber(
  orderId: string,
): Promise<number | null> {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN
  if (!accessToken) {
    throw new Error('Square API access is not configured.')
  }

  const response = await fetch(
    `${squareApiBaseUrl()}/v2/orders/${encodeURIComponent(orderId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Square-Version': '2025-04-16',
      },
    },
  )
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    const detail =
      result?.errors?.[0]?.detail ||
      result?.errors?.[0]?.code ||
      'Square could not retrieve the payment order.'
    throw new Error(detail)
  }

  return extractSquareOrderInvoiceNumber(result?.order)
}

export type SquarePaymentLink = {
  id: string
  orderId: string
  url: string
}

export async function createSquarePaymentLink(params: {
  invoiceId: string
  invoiceNumber: number | string
  amount: number
  customerName: string
  description?: string | null
  idempotencyKey?: string
}): Promise<SquarePaymentLink> {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN
  const locationId = process.env.SQUARE_LOCATION_ID

  if (!accessToken || !locationId) {
    throw new Error('Square payment links are not configured.')
  }

  const cents = Math.round(Number(params.amount) * 100)
  if (!Number.isFinite(cents) || cents <= 0) {
    throw new Error('Invoice total must be greater than zero.')
  }
  const invoiceReference = `Invoice #${String(params.invoiceNumber).trim()}`

  const response = await fetch(
    `${squareApiBaseUrl()}/v2/online-checkout/payment-links`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2025-04-16',
      },
      body: JSON.stringify({
        idempotency_key:
          params.idempotencyKey ?? `ops-invoice-${params.invoiceId}-${cents}`,
        quick_pay: {
          name: `Sasquatch ${invoiceReference} - ${params.customerName}`,
          price_money: {
            amount: cents,
            currency: 'USD',
          },
          location_id: locationId,
        },
        checkout_options: {
          ask_for_shipping_address: false,
        },
        description:
          [invoiceReference, params.description].filter(Boolean).join(' - ') ||
          `Sasquatch Carpet Cleaning ${invoiceReference}`,
        pre_populated_data: {
          buyer_note: `Sasquatch Carpet Cleaning ${invoiceReference}`,
        },
      }),
    },
  )

  const result = await response.json().catch(() => null)
  if (!response.ok) {
    const detail =
      result?.errors?.[0]?.detail ||
      result?.errors?.[0]?.code ||
      'Square could not create a payment link.'
    throw new Error(detail)
  }

  const paymentLink = result?.payment_link
  if (!paymentLink?.id || !paymentLink?.order_id || !paymentLink?.url) {
    throw new Error('Square did not return a complete payment link.')
  }
  return {
    id: paymentLink.id,
    orderId: paymentLink.order_id,
    url: paymentLink.url,
  }
}
