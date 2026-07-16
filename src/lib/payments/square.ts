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
