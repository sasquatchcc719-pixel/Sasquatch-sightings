import {
  getValidQBAccessToken,
  getQBConnectionStatus,
} from '@/lib/quickbooks-auth'
import { createAdminClient } from '@/supabase/server'

const QB_BASE_URL = 'https://quickbooks.api.intuit.com/v3/company'

async function qbFetch(
  realmId: string,
  accessToken: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${QB_BASE_URL}/${realmId}${path}`
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  })
}

export async function findQBCustomerByDisplayName(
  realmId: string,
  accessToken: string,
  displayName: string,
): Promise<string | null> {
  const query = encodeURIComponent(
    `SELECT * FROM Customer WHERE DisplayName = '${displayName.replace(/'/g, "\\'")}'`,
  )
  const res = await qbFetch(
    realmId,
    accessToken,
    `/query?query=${query}&minorversion=65`,
  )
  if (!res.ok) return null
  const data = await res.json()
  const customers = data?.QueryResponse?.Customer || []
  return customers.length > 0 ? customers[0].Id : null
}

export async function createQBCustomer(params: {
  customerId: string
  displayName: string
  email: string | null
  phone: string
  address: {
    street_1: string
    street_2?: string | null
    city: string
    state: string
    zip_code: string
  }
}): Promise<string> {
  const auth = await getValidQBAccessToken()
  if (!auth) throw new Error('QuickBooks not connected')

  // Check if customer already exists
  const existingId = await findQBCustomerByDisplayName(
    auth.realmId,
    auth.accessToken,
    params.displayName,
  )
  if (existingId) return existingId

  const body: Record<string, unknown> = {
    DisplayName: params.displayName,
    BillAddr: {
      Line1: params.address.street_1,
      Line2: params.address.street_2 || undefined,
      City: params.address.city,
      CountrySubDivisionCode: params.address.state,
      PostalCode: params.address.zip_code,
      Country: 'US',
    },
    PrimaryPhone: { FreeFormNumber: params.phone },
  }

  if (params.email) {
    body.PrimaryEmailAddr = { Address: params.email }
  }

  const res = await qbFetch(
    auth.realmId,
    auth.accessToken,
    '/customer?minorversion=65',
    { method: 'POST', body: JSON.stringify(body) },
  )

  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') || 'unknown'
    throw new Error(`QB create customer failed: ${res.status} (tid: ${tid})`)
  }

  const data = await res.json()
  return data.Customer.Id
}

export async function createQBInvoice(params: {
  qbCustomerId: string
  serviceDate: string
  lineItems: Array<{
    description: string
    quantity: number
    unit_price: number
    line_total: number
  }>
  discountAmount?: number
}): Promise<string> {
  const auth = await getValidQBAccessToken()
  if (!auth) throw new Error('QuickBooks not connected')

  const lines = params.lineItems.map((item) => ({
    Amount: item.line_total,
    DetailType: 'SalesItemLineDetail',
    Description: item.description,
    SalesItemLineDetail: {
      Qty: item.quantity,
      UnitPrice: item.unit_price,
    },
  }))

  if (params.discountAmount && params.discountAmount > 0) {
    lines.push({
      Amount: params.discountAmount,
      DetailType: 'DiscountLineDetail' as 'SalesItemLineDetail',
      Description: 'Discount',
      SalesItemLineDetail: {
        Qty: 1,
        UnitPrice: params.discountAmount,
      },
    })
  }

  const body = {
    CustomerRef: { value: params.qbCustomerId },
    TxnDate: params.serviceDate,
    Line: lines,
  }

  const res = await qbFetch(
    auth.realmId,
    auth.accessToken,
    '/invoice?minorversion=65',
    { method: 'POST', body: JSON.stringify(body) },
  )

  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') || 'unknown'
    throw new Error(`QB create invoice failed: ${res.status} (tid: ${tid})`)
  }

  const data = await res.json()
  return data.Invoice.Id
}

export async function syncAppointmentToQuickBooks(appointmentId: string) {
  const status = await getQBConnectionStatus()
  if (!status.connected || !status.sync_enabled) return

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      appointment_date,
      ops_customers (
        id, full_name, first_name, email, phone, quickbooks_customer_id,
        ops_service_addresses ( street_1, street_2, city, state, zip_code )
      ),
      ops_invoices (
        id, subtotal, total, discount_amount, quickbooks_invoice_id,
        ops_invoice_line_items ( description, quantity, unit_price, line_total )
      )
    `,
    )
    .eq('id', appointmentId)
    .single()

  if (!appointment) throw new Error(`Appointment ${appointmentId} not found`)

  const customer = Array.isArray(appointment.ops_customers)
    ? appointment.ops_customers[0]
    : appointment.ops_customers
  const invoice = Array.isArray(appointment.ops_invoices)
    ? appointment.ops_invoices[0]
    : appointment.ops_invoices

  if (!customer || !invoice) throw new Error('Missing customer or invoice data')

  const address = Array.isArray(customer.ops_service_addresses)
    ? customer.ops_service_addresses[0]
    : customer.ops_service_addresses

  // Sync customer if not already in QB
  let qbCustomerId = customer.quickbooks_customer_id
  if (!qbCustomerId) {
    qbCustomerId = await createQBCustomer({
      customerId: customer.id,
      displayName: customer.full_name,
      email: customer.email,
      phone: customer.phone || '',
      address: {
        street_1: address?.street_1 || '',
        street_2: address?.street_2,
        city: address?.city || '',
        state: address?.state || 'CO',
        zip_code: address?.zip_code || '',
      },
    })
    await supabase
      .from('ops_customers')
      .update({ quickbooks_customer_id: qbCustomerId })
      .eq('id', customer.id)
  }

  // Sync invoice if not already in QB
  if (!invoice.quickbooks_invoice_id) {
    const lineItems = Array.isArray(invoice.ops_invoice_line_items)
      ? invoice.ops_invoice_line_items
      : []

    const qbInvoiceId = await createQBInvoice({
      qbCustomerId,
      serviceDate: appointment.appointment_date,
      lineItems,
      discountAmount: Number(invoice.discount_amount || 0),
    })

    await supabase
      .from('ops_invoices')
      .update({ quickbooks_invoice_id: qbInvoiceId, sync_status: 'synced' })
      .eq('id', invoice.id)
  }
}
