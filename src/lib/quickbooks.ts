export const QUICKBOOKS_SYNC_ENABLED =
  process.env.QUICKBOOKS_SYNC_ENABLED?.trim() === 'true'

export type QuickBooksEntityType = 'customer' | 'invoice'
export type QuickBooksSyncStatus = 'held' | 'pending' | 'synced' | 'failed'

export function getQuickBooksSyncStatus(): QuickBooksSyncStatus {
  return QUICKBOOKS_SYNC_ENABLED ? 'pending' : 'held'
}

export function buildQuickBooksCustomerPayload(params: {
  customerId: string
  fullName: string
  email: string | null
  phone: string
  address: {
    street_1: string
    street_2?: string | null
    city: string
    state: string
    zip_code: string
  }
}) {
  return {
    customer_id: params.customerId,
    display_name: params.fullName,
    email: params.email,
    phone: params.phone,
    billing_address: {
      line1: params.address.street_1,
      line2: params.address.street_2 ?? null,
      city: params.address.city,
      country_sub_division_code: params.address.state,
      postal_code: params.address.zip_code,
    },
  }
}

export function buildQuickBooksInvoicePayload(params: {
  invoiceId: string
  customerId: string
  serviceDate: string
  subtotal: number
  total: number
  lineItems: Array<{
    description: string
    quantity: number
    unit_price: number
    line_total: number
  }>
}) {
  return {
    invoice_id: params.invoiceId,
    customer_id: params.customerId,
    service_date: params.serviceDate,
    subtotal: params.subtotal,
    total: params.total,
    lines: params.lineItems,
  }
}
