type ImportedCsvRow = {
  industry: string
  industry_uuid: string
  category: string
  subcategory_1: string
  subcategory_2: string
  uuid: string
  name: string
  description: string
  price: string
  cost: string
  taxable: string
  unit_of_measure: string
  task_code: string
  online_booking_enabled: string
}

export type ImportedServiceRecord = {
  source_uuid: string
  source_system: 'housecall_pro'
  name: string
  slug: string
  description: string | null
  category: string
  default_duration_minutes: number | null
  buffer_minutes: number
  base_price: number | null
  pricing_unit: string
  online_booking_enabled: boolean
  is_active: boolean
  imported_at: string
}

function parseCsvLine(line: string): string[] {
  const output: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      output.push(current)
      current = ''
      continue
    }

    current += char
  }

  output.push(current)
  return output
}

function parseCsv(text: string): ImportedCsvRow[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!normalized) return []

  const lines = normalized.split('\n')
  const headers = parseCsvLine(lines[0]).map((header) => header.trim())

  return lines.slice(1).flatMap((line) => {
    if (!line.trim()) return []
    const values = parseCsvLine(line)
    const row = Object.fromEntries(
      headers.map((header, index) => [header, (values[index] || '').trim()]),
    ) as ImportedCsvRow
    return row.name ? [row] : []
  })
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseCurrency(value: string): number | null {
  const cleaned = value.replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function parseBoolean(value: string): boolean {
  return value.trim().toLowerCase() === 'true'
}

function normalizePricingUnit(row: ImportedCsvRow): string {
  const name = row.name.toLowerCase()
  const unit = row.unit_of_measure.trim().toLowerCase()
  const description = row.description.toLowerCase()

  if (unit) {
    return unit.replace(/\s+/g, '_')
  }
  if (name.includes('per step')) return 'per_step'
  if (name.includes('per linear foot')) return 'per_linear_foot'
  if (name.includes('per foot') || description.includes('per foot'))
    return 'per_sq_ft'
  if (name.includes('per mile')) return 'per_mile'
  if (name.includes('per hour') || description.includes('per hour'))
    return 'per_hour'
  return 'fixed'
}

function shouldSkipRow(row: ImportedCsvRow): boolean {
  const taskCode = row.task_code.trim().toUpperCase()
  if (taskCode.startsWith('DEFAULT_FIRE_FLOOD_MOLD_SERVICE_')) {
    return true
  }

  if (!row.name.trim()) {
    return true
  }

  return false
}

export function mapHousecallProPricebook(params: {
  csvText: string
  existingSlugs?: Set<string>
  defaultBufferMinutes?: number
}): {
  services: ImportedServiceRecord[]
  skipped: number
} {
  const rows = parseCsv(params.csvText)
  const usedSlugs = new Set(params.existingSlugs || [])
  const services: ImportedServiceRecord[] = []
  let skipped = 0

  for (const row of rows) {
    if (shouldSkipRow(row)) {
      skipped += 1
      continue
    }

    const baseSlug = slugify(row.name)
    let slug = baseSlug
    let suffix = 2
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`
      suffix += 1
    }
    usedSlugs.add(slug)

    services.push({
      source_uuid: row.uuid,
      source_system: 'housecall_pro',
      name: row.name,
      slug,
      description: row.description || null,
      category: row.category || 'cleaning',
      default_duration_minutes: null,
      buffer_minutes: params.defaultBufferMinutes ?? 30,
      base_price: parseCurrency(row.price),
      pricing_unit: normalizePricingUnit(row),
      online_booking_enabled: parseBoolean(row.online_booking_enabled),
      is_active: true,
      imported_at: new Date().toISOString(),
    })
  }

  return { services, skipped }
}
