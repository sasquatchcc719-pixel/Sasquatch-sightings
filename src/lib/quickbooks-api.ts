import {
  getValidQBAccessToken,
  getQBConnectionStatus,
} from '@/lib/quickbooks-auth'
import { createAdminClient } from '@/supabase/server'

const QB_BASE_URL = 'https://quickbooks.api.intuit.com/v3/company'
const QB_PAYMENTS_BASE_URL =
  process.env.QUICKBOOKS_SANDBOX === 'true'
    ? 'https://sandbox.api.intuit.com/quickbooks/v4/payments'
    : 'https://api.intuit.com/quickbooks/v4/payments'

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

export async function voidQBInvoice(qbInvoiceId: string): Promise<void> {
  const auth = await getValidQBAccessToken()
  if (!auth) throw new Error('QuickBooks not connected')

  // QB requires a sparse update with SyncToken to void — fetch it first
  const getRes = await qbFetch(
    auth.realmId,
    auth.accessToken,
    `/invoice/${qbInvoiceId}?minorversion=65`,
  )
  if (!getRes.ok) {
    const text = await getRes.text()
    throw new Error(`QB get invoice failed: ${getRes.status} ${text}`)
  }
  const getData = await getRes.json()
  const syncToken = getData.Invoice.SyncToken

  const voidRes = await qbFetch(
    auth.realmId,
    auth.accessToken,
    `/invoice?operation=void&minorversion=65`,
    {
      method: 'POST',
      body: JSON.stringify({ Id: qbInvoiceId, SyncToken: syncToken }),
    },
  )
  if (!voidRes.ok) {
    const text = await voidRes.text()
    throw new Error(`QB void invoice failed: ${voidRes.status} ${text}`)
  }
}

/**
 * If QuickBooks no longer has this invoice (deleted in QBO), clear our stored
 * quickbooks_invoice_id so the next sync can create a replacement.
 */
export async function reconcileStaleQuickBooksInvoiceLink(
  supabase: ReturnType<typeof createAdminClient>,
  invoiceId: string,
  qbInvoiceId: string,
): Promise<boolean> {
  const auth = await getValidQBAccessToken()
  if (!auth) return false

  const res = await qbFetch(
    auth.realmId,
    auth.accessToken,
    `/invoice/${encodeURIComponent(qbInvoiceId)}?minorversion=65`,
  )

  if (res.ok) return false

  let bodyText = ''
  try {
    bodyText = await res.text()
  } catch {
    bodyText = ''
  }

  const missing =
    res.status === 404 ||
    (res.status === 400 &&
      /Object Not Found|not found|could not be found|Invalid ID/i.test(
        bodyText,
      ))

  if (!missing) return false

  await supabase
    .from('ops_invoices')
    .update({
      quickbooks_invoice_id: null,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)

  console.warn(
    `[QB] Cleared stale quickbooks_invoice_id for invoice ${invoiceId} — not in QuickBooks (HTTP ${res.status})`,
  )
  return true
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
  /**
   * Invoice number to set as QuickBooks DocNumber. Required when the QBO
   * account has "Custom transaction numbers" enabled. Coerced to string.
   */
  docNumber?: string | number | null
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

  const body: Record<string, unknown> = {
    CustomerRef: { value: params.qbCustomerId },
    TxnDate: params.serviceDate,
    Line: lines,
  }

  if (params.docNumber !== undefined && params.docNumber !== null) {
    const doc = String(params.docNumber).trim()
    if (doc) body.DocNumber = doc
  }

  const res = await qbFetch(
    auth.realmId,
    auth.accessToken,
    '/invoice?minorversion=65',
    { method: 'POST', body: JSON.stringify(body) },
  )

  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') || 'unknown'
    let bodyText = ''
    try {
      bodyText = await res.text()
    } catch {
      bodyText = ''
    }
    throw new Error(
      `QB create invoice failed: ${res.status} (tid: ${tid}) ${bodyText.slice(0, 500)}`,
    )
  }

  const data = await res.json()
  return data.Invoice.Id
}

export async function chargeCardViaQB(params: {
  token: string
  amount: number
  currency?: string
}): Promise<{
  chargeId: string
  status: string
}> {
  const auth = await getValidQBAccessToken()
  if (!auth) throw new Error('QuickBooks not connected')

  const requestId = crypto.randomUUID()

  const res = await fetch(`${QB_PAYMENTS_BASE_URL}/charges`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Request-Id': requestId,
    },
    body: JSON.stringify({
      amount: params.amount.toFixed(2),
      token: params.token,
      currency: params.currency || 'USD',
      context: {
        mobile: false,
        isEcommerce: true,
      },
    }),
  })

  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') || 'unknown'
    const status = res.status
    throw new Error(`QB charge failed: ${status} (tid: ${tid})`)
  }

  const data = await res.json()
  return {
    chargeId: data.id,
    status: data.status,
  }
}

export async function createQBPayment(params: {
  qbCustomerId: string
  qbInvoiceId: string
  amount: number
  paymentMethod: string
}): Promise<string> {
  const auth = await getValidQBAccessToken()
  if (!auth) throw new Error('QuickBooks not connected')

  const paymentMethodMap: Record<string, string> = {
    cash: 'Cash',
    check: 'Check',
    venmo: 'Other',
    card: 'CreditCard',
  }

  const body: Record<string, unknown> = {
    TotalAmt: params.amount,
    CustomerRef: { value: params.qbCustomerId },
    Line: [
      {
        Amount: params.amount,
        LinkedTxn: [
          {
            TxnId: params.qbInvoiceId,
            TxnType: 'Invoice',
          },
        ],
      },
    ],
  }

  const mappedMethod = paymentMethodMap[params.paymentMethod]
  if (mappedMethod) {
    body.PaymentMethodRef = { value: mappedMethod }
  }

  const res = await qbFetch(
    auth.realmId,
    auth.accessToken,
    '/payment?minorversion=65',
    { method: 'POST', body: JSON.stringify(body) },
  )

  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') || 'unknown'
    throw new Error(`QB create payment failed: ${res.status} (tid: ${tid})`)
  }

  const data = await res.json()
  return data.Payment.Id
}

export async function getQBInvoicePaymentLink(
  qbInvoiceId: string,
): Promise<string | null> {
  const auth = await getValidQBAccessToken()
  if (!auth) return null

  const res = await qbFetch(
    auth.realmId,
    auth.accessToken,
    `/invoice/${qbInvoiceId}?minorversion=65`,
  )

  if (!res.ok) return null

  const data = await res.json()
  const invoiceLink = data?.Invoice?.InvoiceLink
  return invoiceLink || null
}

export async function queryRecentQBPayments(sinceDate: string): Promise<
  Array<{
    Id: string
    TotalAmt: number
    TxnDate: string
    Line: Array<{
      Amount: number
      LinkedTxn: Array<{ TxnId: string; TxnType: string }>
    }>
  }>
> {
  const auth = await getValidQBAccessToken()
  if (!auth) return []

  const query = encodeURIComponent(
    `SELECT * FROM Payment WHERE MetaData.LastUpdatedTime >= '${sinceDate}' MAXRESULTS 100`,
  )
  const res = await qbFetch(
    auth.realmId,
    auth.accessToken,
    `/query?query=${query}&minorversion=65`,
  )

  if (!res.ok) return []

  const data = await res.json()
  return data?.QueryResponse?.Payment || []
}

export async function syncAppointmentToQuickBooks(appointmentId: string) {
  const status = await getQBConnectionStatus()
  if (!status.connected || !status.sync_enabled) {
    console.warn(
      `[QB sync] Skipped appointment ${appointmentId}: connected=${status.connected}, sync_enabled=${status.sync_enabled}`,
    )
    return
  }

  const supabase = createAdminClient()

  const { data: appointment } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      appointment_date,
      kind,
      ops_customers!ops_appointments_customer_id_fkey (
        id, full_name, first_name, email, phone, quickbooks_customer_id,
        ops_service_addresses ( street_1, street_2, city, state, zip_code )
      ),
      ops_invoices (
        id, status, payment_method, subtotal, total, discount_amount, invoice_number, quickbooks_invoice_id,
        ops_invoice_line_items ( description, quantity, unit_price, line_total )
      )
    `,
    )
    .eq('id', appointmentId)
    .single()

  if (!appointment) throw new Error(`Appointment ${appointmentId} not found`)

  // Hard guard: estimates never go to QuickBooks, regardless of who called us.
  // Charles' rule: no estimates in QB, ever. Only the real service appointment
  // that comes out of the convert flow is eligible.
  if ((appointment as { kind?: string | null }).kind === 'estimate') {
    console.log(
      `[QB sync] Skipped appointment ${appointmentId}: kind=estimate (estimates never sync)`,
    )
    return
  }

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

  try {
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

      // Mark customer queue row synced
      await supabase
        .from('ops_quickbooks_sync_jobs')
        .update({ status: 'synced', error_message: null })
        .eq('entity_type', 'customer')
        .eq('entity_id', customer.id)
        .in('status', ['pending', 'failed', 'held'])
    }

    // Sync invoice only after it leaves draft (final amount at job completion).
    // Creating in QuickBooks at booking time caused invoices to freeze at the
    // original quote while the calendar/invoice were updated later.
    // Cash-settled jobs stay out of QuickBooks entirely.
    const invPm = (invoice as { payment_method?: string | null }).payment_method
    let invQbId: string | null = invoice.quickbooks_invoice_id
    if (invQbId) {
      const cleared = await reconcileStaleQuickBooksInvoiceLink(
        supabase,
        invoice.id,
        invQbId,
      )
      if (cleared) invQbId = null
    }

    if (!invQbId) {
      if (invoice.status === 'draft') {
        console.log(
          `[QB sync] Deferred invoice ${invoice.id} — draft until job completed`,
        )
      } else if (invPm === 'cash') {
        console.log(
          `[QB sync] Skipped invoice ${invoice.id} — cash (not sent to QuickBooks)`,
        )
      } else {
        const lineItems = Array.isArray(invoice.ops_invoice_line_items)
          ? invoice.ops_invoice_line_items
          : []

        const qbInvoiceId = await createQBInvoice({
          qbCustomerId,
          serviceDate: appointment.appointment_date,
          lineItems,
          discountAmount: Number(invoice.discount_amount || 0),
          docNumber:
            (invoice as { invoice_number?: number | string | null })
              .invoice_number ?? null,
        })

        await supabase
          .from('ops_invoices')
          .update({ quickbooks_invoice_id: qbInvoiceId, sync_status: 'synced' })
          .eq('id', invoice.id)

        // Mark invoice queue row synced
        await supabase
          .from('ops_quickbooks_sync_jobs')
          .update({ status: 'synced', error_message: null })
          .eq('entity_type', 'invoice')
          .eq('entity_id', invoice.id)
          .in('status', ['pending', 'failed', 'held'])
      }
    }
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : 'Unknown QB sync error'
    console.error(`[QB sync] Failed for appointment ${appointmentId}:`, err)

    // Mark queue rows as failed so they're visible in the admin UI and eligible for retry
    await supabase
      .from('ops_quickbooks_sync_jobs')
      .update({ status: 'failed', error_message: errorMsg })
      .eq('entity_id', customer.id)
      .eq('entity_type', 'customer')
      .in('status', ['pending', 'held'])

    if (invoice) {
      await supabase
        .from('ops_quickbooks_sync_jobs')
        .update({ status: 'failed', error_message: errorMsg })
        .eq('entity_id', invoice.id)
        .eq('entity_type', 'invoice')
        .in('status', ['pending', 'held'])
    }

    throw err
  }
}

/**
 * After line items or totals change locally, replace the QuickBooks invoice so
 * it matches. Skips paid invoices (payments are already applied in QBO).
 */
export async function resyncInvoiceToQuickBooks(invoiceId: string) {
  const conn = await getQBConnectionStatus()
  if (!conn.connected || !conn.sync_enabled) return

  const supabase = createAdminClient()

  const { data: inv } = await supabase
    .from('ops_invoices')
    .select(
      `
      id,
      status,
      payment_method,
      discount_amount,
      invoice_number,
      quickbooks_invoice_id,
      appointment_id,
      ops_invoice_line_items ( description, quantity, unit_price, line_total )
    `,
    )
    .eq('id', invoiceId)
    .single()

  if (!inv?.quickbooks_invoice_id) return
  if (inv.status === 'draft') return
  if ((inv as { payment_method?: string | null }).payment_method === 'cash') {
    return
  }

  const clearedStale = await reconcileStaleQuickBooksInvoiceLink(
    supabase,
    inv.id,
    inv.quickbooks_invoice_id,
  )
  if (clearedStale) return

  const { data: invAfter } = await supabase
    .from('ops_invoices')
    .select('quickbooks_invoice_id')
    .eq('id', invoiceId)
    .single()
  if (!invAfter?.quickbooks_invoice_id) return

  if (inv.status === 'paid') {
    console.warn(
      `[QB resync] Skip invoice ${invoiceId} — already paid in app; fix in QuickBooks manually if needed`,
    )
    return
  }

  const { data: appt } = await supabase
    .from('ops_appointments')
    .select('appointment_date, customer_id')
    .eq('id', inv.appointment_id)
    .single()

  if (!appt) return

  const { data: cust } = await supabase
    .from('ops_customers')
    .select('quickbooks_customer_id')
    .eq('id', appt.customer_id)
    .single()

  const qbCustomerId = cust?.quickbooks_customer_id
  if (!qbCustomerId) {
    console.warn(`[QB resync] No QuickBooks customer for invoice ${invoiceId}`)
    return
  }

  const lineItems = Array.isArray(inv.ops_invoice_line_items)
    ? inv.ops_invoice_line_items
    : []

  const qbIdToReplace = invAfter.quickbooks_invoice_id

  try {
    await voidQBInvoice(qbIdToReplace)
  } catch (err) {
    console.error(`[QB resync] Could not void invoice ${qbIdToReplace}:`, err)
    return
  }

  const qbInvoiceId = await createQBInvoice({
    qbCustomerId,
    serviceDate: appt.appointment_date,
    lineItems,
    discountAmount: Number(inv.discount_amount || 0),
    docNumber:
      (inv as { invoice_number?: number | string | null }).invoice_number ??
      null,
  })

  await supabase
    .from('ops_invoices')
    .update({
      quickbooks_invoice_id: qbInvoiceId,
      sync_status: 'synced',
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
}
