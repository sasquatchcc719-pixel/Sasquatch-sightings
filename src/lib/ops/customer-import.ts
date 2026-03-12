type ParsedCsvRow = Record<string, string>

type ImportCustomerParams = {
  csvText: string
  supabase: {
    from: (table: string) => any
  }
}

export type ImportCustomerResult = {
  insertedCustomers: number
  updatedCustomers: number
  insertedAddresses: number
  skippedRows: number
  errors: string[]
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase()
}

function parseCsv(text: string): ParsedCsvRow[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.trim()) return []

  const rows: string[][] = []
  let currentField = ''
  let currentRow: string[] = []
  let inQuotes = false

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const next = normalized[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentField += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentField)
      currentField = ''
      continue
    }

    if (char === '\n' && !inQuotes) {
      currentRow.push(currentField)
      rows.push(currentRow)
      currentField = ''
      currentRow = []
      continue
    }

    currentField += char
  }

  currentRow.push(currentField)
  rows.push(currentRow)

  if (rows.length <= 1) return []
  const headers = rows[0].map((header) => normalizeHeader(header))
  return rows.slice(1).flatMap((values) => {
    if (!values.some((value) => value.trim())) return []
    const row: ParsedCsvRow = {}
    headers.forEach((header, headerIndex) => {
      row[header] = (values[headerIndex] || '').trim()
    })
    return [row]
  })
}

function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

function buildFullName(params: {
  firstName: string
  lastName: string
  displayName: string
  company: string
  phone: string
}): string {
  const joined = [params.firstName, params.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()
  return (
    params.displayName ||
    joined ||
    params.company ||
    params.phone ||
    'Unknown Customer'
  )
}

function splitMultiline(value: string): string[] {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
}

function parseCityStateZip(value: string): {
  city: string
  state: string
  zip: string
} | null {
  const match = value.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/)
  if (!match) return null
  return {
    city: match[1].trim(),
    state: match[2].trim().toUpperCase(),
    zip: match[3].trim(),
  }
}

function normalizeAddressParts(params: {
  label: string
  street1: string
  street2: string
  city: string
  state: string
  zip: string
  notes: string
  fallbackName: string
}): {
  label: string
  street_1: string
  street_2: string | null
  city: string
  state: string
  zip_code: string
  notes: string | null
} | null {
  let street1 = params.street1.trim()
  let street2 = params.street2.trim()
  let city = params.city.trim()
  let state = params.state.trim().toUpperCase()
  let zip = params.zip.trim()

  const line2Parts = splitMultiline(street2)
  if (!city && line2Parts.length > 0) {
    const parsed = parseCityStateZip(line2Parts[line2Parts.length - 1])
    if (parsed) {
      city = parsed.city
      state = parsed.state
      zip = parsed.zip
      line2Parts.pop()
      if (!street1 && line2Parts.length > 0) {
        street1 = line2Parts.shift() || ''
      }
      street2 = line2Parts.join(', ')
    }
  }

  if (street1 && street1.toLowerCase() === params.fallbackName.toLowerCase()) {
    street1 = ''
  }

  if (!street1 || !city || !state || !zip) {
    return null
  }

  return {
    label: params.label || 'Service Address',
    street_1: street1,
    street_2: street2 || null,
    city,
    state,
    zip_code: zip,
    notes: params.notes.trim() || null,
  }
}

function getAddressesFromRow(row: ParsedCsvRow, fallbackName: string) {
  const addressBlocks = [1, 2].map((index) =>
    normalizeAddressParts({
      label: index === 1 ? 'Service Address' : `Address ${index}`,
      street1: row[`address_${index} street line 1`] || '',
      street2: row[`address_${index} street line 2`] || '',
      city: row[`address_${index} city`] || '',
      state: row[`address_${index} state`] || '',
      zip: row[`address_${index} postal code`] || '',
      notes: row[`address_${index} notes`] || '',
      fallbackName,
    }),
  )

  const dedupe = new Set<string>()
  return addressBlocks.flatMap((address) => {
    if (!address) return []
    const key = `${address.street_1.toLowerCase()}|${address.city.toLowerCase()}|${address.state.toLowerCase()}|${address.zip_code}`
    if (dedupe.has(key)) return []
    dedupe.add(key)
    return [address]
  })
}

export async function importOpsCustomersFromCsv(
  params: ImportCustomerParams,
): Promise<ImportCustomerResult> {
  const rows = parseCsv(params.csvText)
  const result: ImportCustomerResult = {
    insertedCustomers: 0,
    updatedCustomers: 0,
    insertedAddresses: 0,
    skippedRows: 0,
    errors: [],
  }

  if (rows.length === 0) return result

  const { data: existingCustomers, error: existingCustomerError } =
    await params.supabase.from('ops_customers').select('id, phone, email')

  if (existingCustomerError) {
    throw new Error(existingCustomerError.message)
  }

  const byPhone = new Map<string, { id: string; email: string | null }>()
  const byEmail = new Map<string, { id: string; phone: string }>()
  for (const customer of existingCustomers || []) {
    if (customer.phone) byPhone.set(String(customer.phone), customer)
    if (customer.email)
      byEmail.set(String(customer.email).toLowerCase(), customer)
  }

  for (const row of rows) {
    const firstName = row['first name'] || ''
    const lastName = row['last name'] || ''
    const displayName = row['display name'] || ''
    const company = row['company'] || ''
    const email = (row['email'] || '').trim().toLowerCase()
    const phoneRaw =
      row['mobile number'] || row['home number'] || row['work number'] || ''
    if (!phoneRaw.trim()) {
      result.skippedRows += 1
      continue
    }

    const phone = toE164(phoneRaw)
    const fullName = buildFullName({
      firstName,
      lastName,
      displayName,
      company,
      phone,
    })

    const notes = (row['notes'] || '').trim() || null
    const existingByPhone = byPhone.get(phone)
    const existingByEmail = email ? byEmail.get(email) : undefined
    const existing = existingByPhone || existingByEmail

    let customerId = ''
    if (existing?.id) {
      const { data: updated, error: updateError } = await params.supabase
        .from('ops_customers')
        .update({
          full_name: fullName,
          first_name: firstName || null,
          last_name: lastName || null,
          business_name: company || null,
          email: email || null,
          phone,
          notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('id')
        .single()

      if (updateError) {
        result.errors.push(
          `Customer update failed for "${fullName}": ${updateError.message}`,
        )
        continue
      }
      customerId = updated.id
      result.updatedCustomers += 1
    } else {
      const { data: inserted, error: insertError } = await params.supabase
        .from('ops_customers')
        .insert({
          full_name: fullName,
          first_name: firstName || null,
          last_name: lastName || null,
          business_name: company || null,
          email: email || null,
          phone,
          notes,
        })
        .select('id')
        .single()

      if (insertError) {
        result.errors.push(
          `Customer insert failed for "${fullName}": ${insertError.message}`,
        )
        continue
      }
      customerId = inserted.id
      result.insertedCustomers += 1
    }

    byPhone.set(phone, { id: customerId, email: email || null })
    if (email) {
      byEmail.set(email, { id: customerId, phone })
    }

    const addresses = getAddressesFromRow(row, fullName)
    if (addresses.length === 0) continue

    const { data: existingAddresses, error: existingAddressError } =
      await params.supabase
        .from('ops_service_addresses')
        .select('street_1, city, state, zip_code')
        .eq('customer_id', customerId)

    if (existingAddressError) {
      result.errors.push(
        `Address lookup failed for "${fullName}": ${existingAddressError.message}`,
      )
      continue
    }

    const existingAddressKeys = new Set(
      (existingAddresses || []).map(
        (address: {
          street_1: string
          city: string
          state: string
          zip_code: string
        }) =>
          `${String(address.street_1).toLowerCase()}|${String(address.city).toLowerCase()}|${String(address.state).toLowerCase()}|${String(address.zip_code)}`,
      ),
    )

    for (const address of addresses) {
      const key = `${address.street_1.toLowerCase()}|${address.city.toLowerCase()}|${address.state.toLowerCase()}|${address.zip_code}`
      if (existingAddressKeys.has(key)) continue

      const { error: addressInsertError } = await params.supabase
        .from('ops_service_addresses')
        .insert({
          customer_id: customerId,
          ...address,
        })

      if (addressInsertError) {
        result.errors.push(
          `Address insert failed for "${fullName}": ${addressInsertError.message}`,
        )
      } else {
        existingAddressKeys.add(key)
        result.insertedAddresses += 1
      }
    }
  }

  return result
}
