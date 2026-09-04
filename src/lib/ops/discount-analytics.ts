import type { SupabaseClient } from '@supabase/supabase-js'

export type DiscountInvoiceRow = {
  discount_amount?: number | null
  discount_metadata?: unknown
  percentage_discount_amount?: number | null
  percentage_discount_label?: string | null
  ops_appointments?:
    | {
        appointment_date?: string | null
        status?: string | null
      }
    | {
        appointment_date?: string | null
        status?: string | null
      }[]
    | null
}

export type PromoUsageRow = {
  code?: string | null
  use_count?: number | null
  active?: boolean | null
}

export type DiscountAnalytics = {
  year: number
  discountedInvoices: number
  completedInvoices: number
  scheduledInvoices: number
  totalDiscount: number
  completedDiscount: number
  scheduledDiscount: number
  averageDiscount: number
  identifiedInvoices: number
  codeTrackedInvoices: number
  manualInvoices: number
  lifetimeCodeUses: number
  promoCodes: {
    code: string
    useCount: number
    active: boolean
  }[]
  months: {
    month: number
    label: string
    completedAmount: number
    scheduledAmount: number
    invoiceCount: number
  }[]
  breakdown: {
    label: string
    kind: 'promo' | 'automatic' | 'manual'
    invoiceCount: number
    completedInvoices: number
    amount: number
  }[]
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const round2 = (value: number) => Math.round(value * 100) / 100

function appointmentFor(row: DiscountInvoiceRow) {
  return Array.isArray(row.ops_appointments)
    ? row.ops_appointments[0]
    : row.ops_appointments
}

function promoCodeFrom(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const promo = (metadata as { promo?: unknown }).promo
  if (!promo || typeof promo !== 'object') return null
  const code = String((promo as { code?: unknown }).code || '')
    .trim()
    .toUpperCase()
  return code || null
}

export function summarizeDiscountAnalytics(
  invoiceRows: DiscountInvoiceRow[],
  promoRows: PromoUsageRow[],
  year: number,
): DiscountAnalytics {
  const months = MONTHS.map((label, index) => ({
    month: index + 1,
    label,
    completedAmount: 0,
    scheduledAmount: 0,
    invoiceCount: 0,
  }))
  const breakdown = new Map<string, DiscountAnalytics['breakdown'][number]>()

  let discountedInvoices = 0
  let completedInvoices = 0
  let scheduledInvoices = 0
  let totalDiscount = 0
  let completedDiscount = 0
  let scheduledDiscount = 0
  let identifiedInvoices = 0
  let codeTrackedInvoices = 0
  let manualInvoices = 0

  for (const row of invoiceRows) {
    const appointment = appointmentFor(row)
    const appointmentDate = String(appointment?.appointment_date || '')
    if (!appointmentDate.startsWith(`${year}-`)) continue
    if (appointment?.status === 'cancelled') continue

    const dollarAmount = Math.max(0, Number(row.discount_amount || 0))
    const percentageAmount = Math.max(
      0,
      Number(row.percentage_discount_amount || 0),
    )
    const amount = dollarAmount + percentageAmount
    if (amount <= 0) continue

    const promoCode = promoCodeFrom(row.discount_metadata)
    const percentageLabel = String(row.percentage_discount_label || '').trim()
    let label = 'Manual / unlabeled'
    let kind: DiscountAnalytics['breakdown'][number]['kind'] = 'manual'

    if (promoCode) {
      label = promoCode
      kind = 'promo'
      identifiedInvoices++
      codeTrackedInvoices++
    } else if (percentageAmount > 0 && dollarAmount === 0) {
      label = percentageLabel || 'Percentage discount'
      kind = 'automatic'
      identifiedInvoices++
    } else {
      if (percentageAmount > 0) {
        label = `Manual + ${percentageLabel || 'percentage discount'}`
      }
      manualInvoices++
    }

    const month = Number(appointmentDate.slice(5, 7))
    if (month < 1 || month > 12) continue
    const isCompleted = appointment?.status === 'completed'

    discountedInvoices++
    totalDiscount += amount
    months[month - 1].invoiceCount++

    if (isCompleted) {
      completedInvoices++
      completedDiscount += amount
      months[month - 1].completedAmount += amount
    } else {
      scheduledInvoices++
      scheduledDiscount += amount
      months[month - 1].scheduledAmount += amount
    }

    const key = `${kind}:${label}`
    const group = breakdown.get(key) || {
      label,
      kind,
      invoiceCount: 0,
      completedInvoices: 0,
      amount: 0,
    }
    group.invoiceCount++
    if (isCompleted) group.completedInvoices++
    group.amount += amount
    breakdown.set(key, group)
  }

  const promoCodes = promoRows
    .map((row) => ({
      code: String(row.code || '')
        .trim()
        .toUpperCase(),
      useCount: Math.max(0, Number(row.use_count || 0)),
      active: row.active !== false,
    }))
    .filter((row) => row.code && row.useCount > 0)
    .sort((a, b) => b.useCount - a.useCount || a.code.localeCompare(b.code))

  return {
    year,
    discountedInvoices,
    completedInvoices,
    scheduledInvoices,
    totalDiscount: round2(totalDiscount),
    completedDiscount: round2(completedDiscount),
    scheduledDiscount: round2(scheduledDiscount),
    averageDiscount:
      discountedInvoices > 0 ? round2(totalDiscount / discountedInvoices) : 0,
    identifiedInvoices,
    codeTrackedInvoices,
    manualInvoices,
    lifetimeCodeUses: promoCodes.reduce((sum, row) => sum + row.useCount, 0),
    promoCodes,
    months: months.map((month) => ({
      ...month,
      completedAmount: round2(month.completedAmount),
      scheduledAmount: round2(month.scheduledAmount),
    })),
    breakdown: [...breakdown.values()]
      .map((row) => ({ ...row, amount: round2(row.amount) }))
      .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label)),
  }
}

export async function loadDiscountAnalytics(
  supabase: SupabaseClient,
  options?: { year?: number },
): Promise<DiscountAnalytics> {
  const year = options?.year ?? new Date().getFullYear()
  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`

  const [invoiceResult, promoResult] = await Promise.all([
    supabase
      .from('ops_invoices')
      .select(
        `
          discount_amount,
          discount_metadata,
          percentage_discount_amount,
          percentage_discount_label,
          ops_appointments!inner ( appointment_date, status )
        `,
      )
      .gte('ops_appointments.appointment_date', yearStart)
      .lte('ops_appointments.appointment_date', yearEnd)
      .neq('ops_appointments.status', 'cancelled')
      .limit(5000),
    supabase
      .from('promo_codes')
      .select('code, use_count, active')
      .order('code'),
  ])

  if (invoiceResult.error) throw invoiceResult.error
  if (promoResult.error) throw promoResult.error

  return summarizeDiscountAnalytics(
    (invoiceResult.data || []) as DiscountInvoiceRow[],
    (promoResult.data || []) as PromoUsageRow[],
    year,
  )
}
