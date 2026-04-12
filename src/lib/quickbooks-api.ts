import { getValidQBAccessToken } from '@/lib/quickbooks-auth'

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
    const text = await res.text()
    throw new Error(`QB create customer failed: ${res.status} ${text}`)
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
    const text = await res.text()
    throw new Error(`QB create invoice failed: ${res.status} ${text}`)
  }

  const data = await res.json()
  return data.Invoice.Id
}
