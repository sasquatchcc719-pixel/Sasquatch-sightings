import {
  getValidQBAccessToken,
  getQBConnectionStatus,
} from '@/lib/quickbooks-auth'
import { createAdminClient } from '@/supabase/server'
import {
  isMonthlyRestorationSnapshot,
  reportSha256,
  RESTORATION_REPORT_BUCKET,
} from '@/lib/ops/monthly-restoration-billing'

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
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers || {}),
  }

  let lastRes: Response | undefined
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { ...options, headers })
    if (res.status !== 429) return res
    lastRes = res
    // Back off 1s, 2s, 4s before retrying
    await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)))
  }
  return lastRes!
}

export async function findQBCustomerByDisplayName(
  realmId: string,
  accessToken: string,
  displayName: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<string | null> {
  // QuickBooks trims trailing whitespace when it stores a DisplayName but
  // matches the raw string on query, so an untrimmed name misses the record
  // it is about to collide with.
  const name = displayName.trim().replace(/'/g, "\\'")

  // Inactive (deleted) customers still reserve their name, so a create can be
  // rejected as a duplicate even when the default active-only query is empty.
  const query = encodeURIComponent(
    includeInactive
      ? `SELECT * FROM Customer WHERE DisplayName = '${name}' AND Active IN (true, false)`
      : `SELECT * FROM Customer WHERE DisplayName = '${name}'`,
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

  const displayName = params.displayName.trim()

  // Check if customer already exists
  const existingId = await findQBCustomerByDisplayName(
    auth.realmId,
    auth.accessToken,
    displayName,
  )
  if (existingId) return existingId

  const body: Record<string, unknown> = {
    DisplayName: displayName,
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
    // Keep QuickBooks' own explanation. Logging only the status code left
    // every customer failure undiagnosable — the body is where QBO says
    // things like "Duplicate Name Exists Error".
    const detail = await readQBErrorDetail(res)

    // "Duplicate Name Exists" means this customer is already in QuickBooks
    // under this name — the outcome we wanted, not a failure. The lookup above
    // misses when the existing record is inactive, so re-query including those
    // and adopt the id rather than retrying a create that can never succeed.
    if (/Duplicate Name Exists/i.test(detail || '')) {
      const duplicateId = await findQBCustomerByDisplayName(
        auth.realmId,
        auth.accessToken,
        displayName,
        { includeInactive: true },
      )
      if (duplicateId) return duplicateId
    }

    throw new Error(
      `QB create customer failed: ${res.status} (tid: ${tid})${detail ? ` — ${detail}` : ''}`,
    )
  }

  const data = await res.json()
  return data.Customer.Id
}

/**
 * Pull the human-readable reason out of a QuickBooks error response.
 * QBO nests it under Fault.Error[]; fall back to raw text when the shape is
 * unexpected so we never swallow the reason entirely.
 */
async function readQBErrorDetail(res: Response): Promise<string | null> {
  try {
    const raw = await res.text()
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as {
        Fault?: { Error?: Array<{ Message?: string; Detail?: string }> }
      }
      const errors = parsed.Fault?.Error
      if (errors?.length) {
        return errors
          .map((e) => [e.Message, e.Detail].filter(Boolean).join(': '))
          .join(' | ')
          .slice(0, 500)
      }
    } catch {
      // not JSON — fall through to the raw body
    }
    return raw.slice(0, 500)
  } catch {
    return null
  }
}

type QBInvoiceMatch = {
  id: string
  docNumber: string | null
  customerId: string | null
  customerName: string | null
  txnDate: string | null
  total: number | null
}

function qbEscape(value: string): string {
  return value.replace(/'/g, "\\'")
}

async function findQBInvoiceByDocNumber(
  realmId: string,
  accessToken: string,
  docNumber: string,
): Promise<QBInvoiceMatch | null> {
  const query = encodeURIComponent(
    `SELECT * FROM Invoice WHERE DocNumber = '${qbEscape(docNumber)}'`,
  )
  const res = await qbFetch(
    realmId,
    accessToken,
    `/query?query=${query}&minorversion=65`,
  )
  if (!res.ok) return null

  const data = await res.json()
  const invoice = data?.QueryResponse?.Invoice?.[0]
  if (!invoice?.Id) return null

  return {
    id: String(invoice.Id),
    docNumber: invoice.DocNumber ? String(invoice.DocNumber) : null,
    customerId: invoice.CustomerRef?.value
      ? String(invoice.CustomerRef.value)
      : null,
    customerName: invoice.CustomerRef?.name
      ? String(invoice.CustomerRef.name)
      : null,
    txnDate: invoice.TxnDate ? String(invoice.TxnDate) : null,
    total:
      invoice.TotalAmt !== undefined && invoice.TotalAmt !== null
        ? Number(invoice.TotalAmt)
        : null,
  }
}

function centsMatch(left: number | null, right: number): boolean {
  if (left === null || !Number.isFinite(left)) return false
  return Math.round(left * 100) === Math.round(right * 100)
}

/**
 * Pull the QuickBooks TxnId out of a "Duplicate Document Number" fault.
 *
 * Only adopts the id when the fault names the DocNumber we actually sent, so
 * an unrelated collision still fails loudly.
 */
export function adoptDuplicateInvoiceId(
  bodyText: string,
  docNumber: number | string,
): string | null {
  const doc = String(docNumber).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`DocNumber=${doc}\\b[^]*?TxnId=(\\d+)`, 'i').exec(
    bodyText,
  )
  return m?.[1] ?? null
}

function isSameQBInvoice(
  existing: QBInvoiceMatch,
  customerId: string,
  serviceDate: string,
  expectedTotal: number,
): boolean {
  return (
    existing.customerId === customerId &&
    existing.txnDate === serviceDate &&
    centsMatch(existing.total, expectedTotal)
  )
}

function sumInvoiceTotal(
  lineItems: Array<{ line_total: number }>,
  discountAmount?: number,
): number {
  const subtotal = lineItems.reduce(
    (sum, item) => sum + Number(item.line_total || 0),
    0,
  )
  return Number((subtotal - Number(discountAmount || 0)).toFixed(2))
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
    product_name?: string | null
    service_catalog_item_id?: string | null
    quickbooks_item_id?: string | null
    quantity: number
    unit_price: number
    line_total: number
    service_date?: string | null
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

  const docNumber =
    params.docNumber !== undefined && params.docNumber !== null
      ? String(params.docNumber).trim()
      : ''
  const expectedTotal = sumInvoiceTotal(params.lineItems, params.discountAmount)

  if (docNumber) {
    const existing = await findQBInvoiceByDocNumber(
      auth.realmId,
      auth.accessToken,
      docNumber,
    )
    if (existing) {
      if (
        isSameQBInvoice(
          existing,
          params.qbCustomerId,
          params.serviceDate,
          expectedTotal,
        )
      ) {
        return existing.id
      }

      throw new Error(
        `QB invoice DocNumber collision: ${docNumber} already belongs to ${existing.customerName || existing.customerId || 'another customer'} (${existing.txnDate || 'unknown date'}, $${existing.total ?? 'unknown'})`,
      )
    }
  }

  const itemRefCache = new Map<string, { value: string; name: string } | null>()
  const lines: Record<string, unknown>[] = []
  for (const item of params.lineItems) {
    const productName = String(item.product_name || item.description || '')
      .trim()
      .replace(/\s+/g, ' ')
    const itemRef = item.quickbooks_item_id
      ? { value: String(item.quickbooks_item_id), name: productName }
      : await resolveQBItemRef(
          auth.realmId,
          auth.accessToken,
          item.service_catalog_item_id,
          productName,
          itemRefCache,
        )

    lines.push({
      Amount: item.line_total,
      DetailType: 'SalesItemLineDetail',
      Description: item.description,
      SalesItemLineDetail: {
        ...(itemRef ? { ItemRef: itemRef } : {}),
        Qty: item.quantity,
        UnitPrice: item.unit_price,
        ServiceDate: item.service_date || params.serviceDate,
      },
    })
  }

  if (params.discountAmount && params.discountAmount > 0) {
    lines.push({
      Amount: params.discountAmount,
      DetailType: 'DiscountLineDetail',
      Description: 'Discount',
      DiscountLineDetail: {
        PercentBased: false,
      },
    })
  }

  const body: Record<string, unknown> = {
    CustomerRef: { value: params.qbCustomerId },
    TxnDate: params.serviceDate,
    Line: lines,
  }

  if (docNumber) {
    body.DocNumber = docNumber
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

    // Two serverless workers can both pass the lookup before either POST
    // finishes. QBO accepts one and rejects the other as a duplicate. Resolve
    // that race as success only when the invoice QBO kept is the exact same
    // customer/date/total; a real DocNumber collision must still fail.
    if (docNumber && /Duplicate Document Number/i.test(bodyText)) {
      const existing = await findQBInvoiceByDocNumber(
        auth.realmId,
        auth.accessToken,
        docNumber,
      )
      if (
        existing &&
        isSameQBInvoice(
          existing,
          params.qbCustomerId,
          params.serviceDate,
          expectedTotal,
        )
      ) {
        return existing.id
      }
    }

    /**
     * Last resort on a duplicate: take the id QuickBooks just told us.
     *
     * createQBInvoice writes to QuickBooks and only then does the caller
     * store quickbooks_invoice_id. A worker killed between those two
     * statements leaves the invoice in QuickBooks and no record of it here,
     * so the next run tries to create it again and QBO refuses the DocNumber.
     * The check above handles that, but only when customer, date and total
     * all match exactly — any drift and a real, already-synced invoice is
     * reported as a hard failure forever, which is how #18453 blocked the
     * whole queue and #18696 landed in QuickBooks while reading "failed".
     *
     * The error body names the transaction outright:
     *   "DocNumber=18696 is assigned to TxnType=Invoice with TxnId=6575"
     * Adopt it, but only when the DocNumber it names is the one we sent.
     */
    if (docNumber) {
      const claim = adoptDuplicateInvoiceId(bodyText, docNumber)
      if (claim) {
        console.warn(
          `[QB] Adopting existing invoice ${claim} for DocNumber ${docNumber} — created by an earlier run that died before recording it`,
        )
        return claim
      }
    }

    throw new Error(
      `QB create invoice failed: ${res.status} (tid: ${tid}) ${bodyText.slice(0, 500)}`,
    )
  }

  const data = await res.json()
  return data.Invoice.Id
}

// Resolves a QuickBooks Item ref for an invoice line. Prefers the cached
// `service_catalog_items.quickbooks_item_id` (immune to catalog renames);
// falls back to a name lookup and persists the result so future lines for
// the same catalog item skip the name lookup entirely.
async function resolveQBItemRef(
  realmId: string,
  accessToken: string,
  catalogItemId: string | null | undefined,
  fallbackName: string,
  cache: Map<string, { value: string; name: string } | null>,
): Promise<{ value: string; name: string } | null> {
  if (!catalogItemId) {
    return fallbackName
      ? findQBItemRefByName(realmId, accessToken, fallbackName, cache)
      : null
  }

  const cacheKey = `id:${catalogItemId}`
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null

  const supabase = createAdminClient()
  const { data: catalogItem } = await supabase
    .from('service_catalog_items')
    .select('quickbooks_item_id')
    .eq('id', catalogItemId)
    .single()

  if (catalogItem?.quickbooks_item_id) {
    const ref = { value: catalogItem.quickbooks_item_id, name: fallbackName }
    cache.set(cacheKey, ref)
    return ref
  }

  const ref = fallbackName
    ? await findQBItemRefByName(realmId, accessToken, fallbackName, cache)
    : null
  if (ref) {
    await supabase
      .from('service_catalog_items')
      .update({ quickbooks_item_id: ref.value })
      .eq('id', catalogItemId)
  }
  cache.set(cacheKey, ref)
  return ref
}

export async function findQBItemRefByName(
  realmId: string,
  accessToken: string,
  name: string,
  cache: Map<string, { value: string; name: string } | null>,
): Promise<{ value: string; name: string } | null> {
  const key = name.toLowerCase()
  if (cache.has(key)) return cache.get(key) ?? null

  const escapedName = name.replace(/'/g, "\\'")
  const queries = [
    `SELECT * FROM Item WHERE Name = '${escapedName}'`,
    `SELECT * FROM Item WHERE FullyQualifiedName = '${escapedName}'`,
  ]

  for (const rawQuery of queries) {
    const query = encodeURIComponent(rawQuery)
    const res = await qbFetch(
      realmId,
      accessToken,
      `/query?query=${query}&minorversion=65`,
    )
    if (!res.ok) continue

    const data = await res.json()
    const item = data?.QueryResponse?.Item?.[0]
    if (item?.Id) {
      const ref = { value: String(item.Id), name: String(item.Name || name) }
      cache.set(key, ref)
      return ref
    }
  }

  cache.set(key, null)
  return null
}

type QBAttachable = {
  Id?: string
  FileName?: string
  AttachableRef?: Array<{
    EntityRef?: { type?: string; value?: string }
  }>
}

async function findQBAttachment(
  realmId: string,
  accessToken: string,
  invoiceId: string,
  fileName: string,
): Promise<string | null> {
  const escaped = fileName.replace(/'/g, "\\'")
  const query = encodeURIComponent(
    `SELECT * FROM Attachable WHERE FileName = '${escaped}'`,
  )
  const response = await qbFetch(
    realmId,
    accessToken,
    `/query?query=${query}&minorversion=65`,
  )
  if (!response.ok) return null
  const data = await response.json()
  const attachables = (data?.QueryResponse?.Attachable ?? []) as QBAttachable[]
  const match = attachables.find((attachable) =>
    (attachable.AttachableRef ?? []).some(
      (ref) =>
        ref.EntityRef?.type === 'Invoice' &&
        String(ref.EntityRef?.value) === String(invoiceId),
    ),
  )
  return match?.Id ? String(match.Id) : null
}

/** Upload one immutable report and link it to an existing QBO invoice. */
async function uploadQBInvoiceAttachment(params: {
  realmId: string
  accessToken: string
  invoiceId: string
  fileName: string
  buffer: Buffer
}): Promise<string> {
  const existing = await findQBAttachment(
    params.realmId,
    params.accessToken,
    params.invoiceId,
    params.fileName,
  )
  if (existing) return existing

  const metadata = {
    FileName: params.fileName,
    ContentType: 'application/pdf',
    AttachableRef: [
      {
        EntityRef: { type: 'Invoice', value: params.invoiceId },
        IncludeOnSend: true,
      },
    ],
  }
  const form = new FormData()
  form.append(
    'file_metadata_01',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
  )
  form.append(
    'file_content_01',
    new Blob([new Uint8Array(params.buffer)], { type: 'application/pdf' }),
    params.fileName,
  )

  const url = `${QB_BASE_URL}/${params.realmId}/upload?minorversion=65`
  let response: Response | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
      },
      body: form,
    })
    if (response.status !== 429) break
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
  }
  if (!response?.ok) {
    const detail = response ? await readQBErrorDetail(response) : null
    throw new Error(
      `QB attachment upload failed: ${response?.status ?? 'no response'}${detail ? ` — ${detail}` : ''}`,
    )
  }
  const data = await response.json()
  const uploaded = (data?.AttachableResponse ?? []) as Array<{
    Attachable?: QBAttachable
    Fault?: unknown
  }>
  const id = uploaded[0]?.Attachable?.Id
  if (!id) throw new Error('QB attachment upload returned no Attachable id')
  return String(id)
}

export async function syncBatchInvoiceToQuickBooks(batchInvoiceId: string) {
  const status = await getQBConnectionStatus()
  if (!status.connected || !status.sync_enabled) {
    throw new Error('QuickBooks sync is disabled or not connected')
  }

  const supabase = createAdminClient()
  const { data: batchInvoice } = await supabase
    .from('ops_batch_invoices')
    .select(
      `
      id,
      customer_id,
      month,
      total,
      discount_amount,
      invoice_number,
      quickbooks_invoice_id,
      ops_customers!ops_batch_invoices_customer_id_fkey (
        id, full_name, business_name, email, phone, quickbooks_customer_id,
        ops_service_addresses ( street_1, street_2, city, state, zip_code )
      ),
      ops_batch_invoice_entries (
        id,
        entry_type,
        restoration_project_id,
        service_date,
        line_items_snapshot,
        attachment_status,
        quickbooks_attachable_id,
        ops_appointments ( appointment_date ),
        restoration_projects (
          final_report_storage_path,
          final_report_sha256,
          final_report_version
        )
      )
    `,
    )
    .eq('id', batchInvoiceId)
    .single()

  if (!batchInvoice) {
    throw new Error(`Batch invoice ${batchInvoiceId} not found`)
  }

  const customer = Array.isArray(batchInvoice.ops_customers)
    ? batchInvoice.ops_customers[0]
    : batchInvoice.ops_customers

  if (!customer) {
    throw new Error('Missing customer data')
  }

  const address = Array.isArray(customer.ops_service_addresses)
    ? customer.ops_service_addresses[0]
    : customer.ops_service_addresses

  let qbCustomerId = customer.quickbooks_customer_id
  if (!qbCustomerId) {
    qbCustomerId = await createQBCustomer({
      customerId: customer.id,
      displayName: customer.business_name || customer.full_name,
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

  const entries = Array.isArray(batchInvoice.ops_batch_invoice_entries)
    ? batchInvoice.ops_batch_invoice_entries
    : []

  const lineItems = entries.flatMap((entry) => {
    const appointment = Array.isArray(entry.ops_appointments)
      ? entry.ops_appointments[0]
      : entry.ops_appointments
    const date =
      entry.service_date || appointment?.appointment_date || batchInvoice.month
    const snapshot = isMonthlyRestorationSnapshot(entry.line_items_snapshot)
      ? entry.line_items_snapshot.charges.map((charge) => ({
          name_snapshot: charge.description,
          notes: null,
          quantity: charge.quantity,
          unit_price: charge.unitPrice,
          line_total: charge.lineTotal,
          service_catalog_item_id: charge.serviceCatalogItemId,
          quickbooks_item_id: charge.quickbooksItemId,
          service_date: charge.serviceDate,
        }))
      : Array.isArray(entry.line_items_snapshot)
        ? entry.line_items_snapshot
        : []

    return snapshot.map(
      (line: {
        name_snapshot: string
        notes?: string | null
        quantity: number
        unit_price: number
        line_total: number
        service_catalog_item_id?: string | null
        quickbooks_item_id?: string | null
        service_date?: string | null
      }) => {
        const lineDate = line.service_date || date
        const datePrefix = new Date(`${lineDate}T12:00:00`).toLocaleDateString(
          'en-US',
          { month: 'short', day: 'numeric' },
        )
        return {
          description: `${datePrefix} — ${line.notes || line.name_snapshot}`,
          product_name: line.name_snapshot,
          service_catalog_item_id: line.service_catalog_item_id,
          quickbooks_item_id: line.quickbooks_item_id,
          quantity: Number(line.quantity || 1),
          unit_price: Number(line.unit_price || 0),
          line_total: Number(line.line_total || 0),
          service_date: lineDate,
        }
      },
    )
  })

  const expectedTotal =
    Math.round(
      (lineItems.reduce((sum, line) => sum + Number(line.line_total), 0) -
        Number(batchInvoice.discount_amount || 0)) *
        100,
    ) / 100
  if (expectedTotal !== Number(batchInvoice.total)) {
    throw new Error(
      `Batch reconciliation failed: snapshot total ${expectedTotal.toFixed(2)} does not match invoice ${Number(batchInvoice.total).toFixed(2)}`,
    )
  }

  let qbInvoiceId = batchInvoice.quickbooks_invoice_id
  if (!qbInvoiceId) {
    qbInvoiceId = await createQBInvoice({
      qbCustomerId,
      serviceDate: batchInvoice.month,
      lineItems,
      discountAmount: Number(batchInvoice.discount_amount || 0),
      docNumber:
        (batchInvoice as { invoice_number?: number | string | null })
          .invoice_number ?? null,
    })

    // Persist the external id before uploading documents. A retry can now
    // resume attachments without ever creating a second QuickBooks invoice.
    await supabase
      .from('ops_batch_invoices')
      .update({
        quickbooks_invoice_id: qbInvoiceId,
        sync_status: 'attaching',
        status: 'ready',
        updated_at: new Date().toISOString(),
      })
      .eq('id', batchInvoice.id)
  }

  const auth = await getValidQBAccessToken()
  if (!auth) throw new Error('QuickBooks not connected')
  const attachmentErrors: string[] = []
  for (const entry of entries) {
    if (entry.entry_type !== 'restoration') continue
    if (
      entry.attachment_status === 'attached' &&
      entry.quickbooks_attachable_id
    ) {
      continue
    }
    const project = Array.isArray(entry.restoration_projects)
      ? entry.restoration_projects[0]
      : entry.restoration_projects
    if (
      !project?.final_report_storage_path ||
      !project.final_report_sha256 ||
      !project.final_report_version
    ) {
      const message = 'Frozen restoration report metadata is missing'
      attachmentErrors.push(`${entry.id}: ${message}`)
      await supabase
        .from('ops_batch_invoice_entries')
        .update({ attachment_status: 'failed', attachment_error: message })
        .eq('id', entry.id)
      continue
    }

    try {
      const { data: object, error: downloadError } = await supabase.storage
        .from(RESTORATION_REPORT_BUCKET)
        .download(project.final_report_storage_path)
      if (downloadError || !object) {
        throw new Error(downloadError?.message ?? 'Stored report is missing')
      }
      const buffer = Buffer.from(await object.arrayBuffer())
      if (reportSha256(buffer) !== project.final_report_sha256) {
        throw new Error('Stored report checksum does not match close snapshot')
      }
      const attachableId = await uploadQBInvoiceAttachment({
        realmId: auth.realmId,
        accessToken: auth.accessToken,
        invoiceId: qbInvoiceId,
        fileName: `restoration-${entry.restoration_project_id}-v${project.final_report_version}.pdf`,
        buffer,
      })
      await supabase
        .from('ops_batch_invoice_entries')
        .update({
          attachment_status: 'attached',
          quickbooks_attachable_id: attachableId,
          attachment_error: null,
          attached_at: new Date().toISOString(),
        })
        .eq('id', entry.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      attachmentErrors.push(`${entry.id}: ${message}`)
      await supabase
        .from('ops_batch_invoice_entries')
        .update({ attachment_status: 'failed', attachment_error: message })
        .eq('id', entry.id)
    }
  }

  if (attachmentErrors.length > 0) {
    await supabase
      .from('ops_batch_invoices')
      .update({
        attachment_status: 'partial',
        attachment_error: attachmentErrors.join(' | ').slice(0, 2_000),
        sync_status: 'partial',
        status: 'ready',
        updated_at: new Date().toISOString(),
      })
      .eq('id', batchInvoice.id)
    throw new Error(
      `QuickBooks invoice created, but report attachment failed: ${attachmentErrors.join(' | ')}`,
    )
  }

  const hasRestoration = entries.some(
    (entry) => entry.entry_type === 'restoration',
  )
  const sentAt = new Date().toISOString()

  await supabase
    .from('ops_batch_invoices')
    .update({
      quickbooks_invoice_id: qbInvoiceId,
      sync_status: 'synced',
      status: 'sent',
      attachment_status: hasRestoration ? 'complete' : 'not_required',
      attachment_error: null,
      sent_at: sentAt,
      updated_at: sentAt,
    })
    .eq('id', batchInvoice.id)

  const restorationProjectIds = entries
    .filter((entry) => entry.entry_type === 'restoration')
    .map((entry) => entry.restoration_project_id)
    .filter((id): id is string => Boolean(id))
  if (restorationProjectIds.length > 0) {
    await supabase
      .from('restoration_projects')
      .update({ billing_status: 'sent', updated_at: sentAt })
      .in('id', restorationProjectIds)
  }

  return qbInvoiceId
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
        id, full_name, first_name, business_name, email, phone,
        quickbooks_customer_id,
        ops_service_addresses ( street_1, street_2, city, state, zip_code )
      ),
      ops_invoices (
        id, status, payment_method, subtotal, total, discount_amount, percentage_discount_amount, invoice_number, quickbooks_invoice_id,
        ops_invoice_line_items ( description, quantity, unit_price, line_total, service_catalog_item_id )
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
        displayName: customer.business_name || customer.full_name,
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
          ? invoice.ops_invoice_line_items.map((line) => ({
              ...line,
              product_name: line.description,
            }))
          : []

        const qbInvoiceId = await createQBInvoice({
          qbCustomerId,
          serviceDate: appointment.appointment_date,
          lineItems,
          discountAmount:
            Number(invoice.discount_amount || 0) +
            Number(invoice.percentage_discount_amount || 0),
          docNumber:
            (invoice as { invoice_number?: number | string | null })
              .invoice_number ?? null,
        })

        await supabase
          .from('ops_invoices')
          .update({
            quickbooks_invoice_id: qbInvoiceId,
            sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
          })
          .eq('id', invoice.id)

        // Mark invoice queue row synced
        await supabase
          .from('ops_quickbooks_sync_jobs')
          .update({ status: 'synced', error_message: null })
          .eq('entity_type', 'invoice')
          .eq('entity_id', invoice.id)
          .in('status', ['pending', 'failed', 'held'])

        // Invoices always land in QuickBooks as open/unpaid. The app's
        // payment-method selection is an internal record only and is no longer
        // pushed to QB — Charles records/matches payments in QuickBooks itself.
        // (The QB card-charge route still records its own payment, since money
        // actually moves through QuickBooks Payments there.)
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
      percentage_discount_amount,
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
    ? inv.ops_invoice_line_items.map((line) => ({
        ...line,
        product_name: line.description,
      }))
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
    discountAmount:
      Number(inv.discount_amount || 0) +
      Number(inv.percentage_discount_amount || 0),
    docNumber:
      (inv as { invoice_number?: number | string | null }).invoice_number ??
      null,
  })

  await supabase
    .from('ops_invoices')
    .update({
      quickbooks_invoice_id: qbInvoiceId,
      sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
}
