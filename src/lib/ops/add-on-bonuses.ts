import type { createAdminClient } from '@/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

export type AddOnBonusCategory =
  | 'carpet_cleaning'
  | 'tile_and_grout'
  | 'rug_cleaning'
  | 'upholstery_cleaning'

export const ADD_ON_BONUS_CATEGORY_LABELS: Record<AddOnBonusCategory, string> =
  {
    carpet_cleaning: 'Carpet cleaning',
    tile_and_grout: 'Tile & grout',
    rug_cleaning: 'Rug cleaning',
    upholstery_cleaning: 'Furniture / upholstery',
  }

export type AddOnBonusRow = {
  key: string
  appointmentId: string
  appointmentDate: string
  staffUserId: string
  staffName: string
  customerName: string
  category: AddOnBonusCategory | 'invoice_growth'
  categoryLabel: string
  eligibleRevenue: number
  bonusRate: number
  bonusAmount: number
  status: 'earned' | 'pending'
}

export type AddOnBonusSummary = {
  rows: AddOnBonusRow[]
  earnedBonus: number
  pendingBonus: number
  eligibleRevenue: number
}

function normalize(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

/**
 * Only whole service categories qualify. Fees, estimate corrections and
 * ancillary treatments do not become bonuses just because they live beside
 * carpet services in the catalog.
 */
export function qualifyingAddOnCategory(
  catalogCategory: string | null | undefined,
  serviceName: string | null | undefined,
): AddOnBonusCategory | null {
  const category = normalize(catalogCategory)
  const name = normalize(serviceName)

  if (category === 'rug cleaning' || (!category && /\brug\b/.test(name))) {
    return 'rug_cleaning'
  }
  if (
    category === 'upholstery cleaning' ||
    (!category &&
      /(sofa|couch|sectional|recliner|love seat|dining chair|ottoman|upholstery)/.test(
        name,
      ))
  ) {
    return 'upholstery_cleaning'
  }
  if ((category === 'hard surface' || !category) && /(tile|grout)/.test(name)) {
    return 'tile_and_grout'
  }
  if (
    (category === 'carpet cleaning' || !category) &&
    /(step carpet|room|walk-in closet|encapsulation|commercial carpet)/.test(
      name,
    )
  ) {
    return 'carpet_cleaning'
  }

  return null
}

export function isNewQualifyingServiceCategory(
  category: AddOnBonusCategory | null,
  baselineCategories: readonly AddOnBonusCategory[],
): category is AddOnBonusCategory {
  return Boolean(category && !baselineCategories.includes(category))
}

function unwrap<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export async function captureAddOnBonusBaseline(
  supabase: AdminClient,
  appointmentId: string,
): Promise<AddOnBonusCategory[]> {
  const { data: appointment, error: appointmentError } = await supabase
    .from('ops_appointments')
    .select(
      `
      add_on_bonus_baseline_categories, commission_baseline_captured_at,
      appointment_date, assigned_staff_user_id,
      assigned_staff:staff_users!ops_appointments_assigned_staff_user_id_fkey (
        add_on_bonus_rate, invoice_growth_bonus_starts_on
      )
    `,
    )
    .eq('id', appointmentId)
    .single()

  if (appointmentError) throw appointmentError
  if (appointment.commission_baseline_captured_at) {
    return (appointment.add_on_bonus_baseline_categories ||
      []) as AddOnBonusCategory[]
  }

  const { data: lines, error: linesError } = await supabase
    .from('ops_appointment_line_items')
    .select(
      `
        name_snapshot,
        line_total,
        excluded_at,
        service_catalog_items (category, name)
      `,
    )
    .eq('appointment_id', appointmentId)

  if (linesError) throw linesError

  const categories = new Set<AddOnBonusCategory>()
  let baselineTotal = 0
  for (const line of lines || []) {
    if (line.excluded_at) continue
    baselineTotal += Number(line.line_total || 0)
    const catalog = unwrap(line.service_catalog_items)
    const category = qualifyingAddOnCategory(
      catalog?.category,
      catalog?.name || line.name_snapshot,
    )
    if (category) categories.add(category)
  }

  const technician = unwrap(appointment.assigned_staff)
  const growthPolicy =
    usesInvoiceGrowthBonus(
      appointment.appointment_date,
      technician?.invoice_growth_bonus_starts_on,
    ) && Number(technician?.add_on_bonus_rate || 0) > 0
  let growthBaseline: number | null = null
  if (growthPolicy) {
    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .select(INVOICE_BONUS_SELECT)
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (invoiceError) throw invoiceError
    // Monthly/project visits may have no individual invoice. Let work start,
    // and defer the snapshot until an invoice exists rather than inventing $0.
    if (!invoice) return [...categories]
    growthBaseline = invoiceBonusRevenue(invoice)
  }

  const capturedAt = new Date().toISOString()
  const baselineCategories = [...categories]
  const { data: captured, error: captureError } = await supabase
    .from('ops_appointments')
    .update({
      add_on_bonus_baseline_categories: baselineCategories,
      commission_baseline_total: Math.round(baselineTotal * 100) / 100,
      commission_baseline_captured_at: capturedAt,
      ...(growthPolicy
        ? {
            invoice_growth_baseline_total: growthBaseline,
            invoice_growth_bonus_staff_user_id:
              appointment.assigned_staff_user_id,
            invoice_growth_bonus_rate: Number(
              technician?.add_on_bonus_rate || 0,
            ),
          }
        : {}),
    })
    .eq('id', appointmentId)
    .is('commission_baseline_captured_at', null)
    .select('add_on_bonus_baseline_categories')
    .maybeSingle()

  if (captureError) throw captureError
  if (captured) {
    return (captured.add_on_bonus_baseline_categories ||
      []) as AddOnBonusCategory[]
  }

  const { data: raced, error: racedError } = await supabase
    .from('ops_appointments')
    .select('add_on_bonus_baseline_categories')
    .eq('id', appointmentId)
    .single()
  if (racedError) throw racedError
  return (raced.add_on_bonus_baseline_categories || []) as AddOnBonusCategory[]
}

export function discountedEligibleRevenue(
  lineRevenue: number,
  subtotal: number,
  discountAmount: number,
  percentageDiscountAmount: number,
): number {
  if (lineRevenue <= 0 || subtotal <= 0) return 0
  const netSubtotal = Math.max(
    0,
    subtotal - discountAmount - percentageDiscountAmount,
  )
  const factor = Math.min(1, netSubtotal / subtotal)
  return Math.round(lineRevenue * factor * 100) / 100
}

export function usesInvoiceGrowthBonus(
  appointmentDate: string,
  startsOn: string | null | undefined,
): boolean {
  return Boolean(startsOn && appointmentDate >= startsOn)
}

const INVOICE_BONUS_SELECT = `
  id, appointment_id, payment_status, subtotal, discount_amount,
  percentage_discount_amount, minimum_charge_adjustment, created_at,
  ops_invoice_line_items (
    description, line_total, excluded_at,
    service_catalog_items (name, slug)
  )
`

type BonusInvoice = {
  subtotal: number | string | null
  discount_amount: number | string | null
  percentage_discount_amount: number | string | null
  minimum_charge_adjustment?: number | string | null
  ops_invoice_line_items?:
    | {
        description: string
        line_total: number | string | null
        excluded_at: string | null
        service_catalog_items:
          | { name: string; slug: string | null }
          | { name: string; slug: string | null }[]
          | null
      }[]
    | null
}

/** Compare net invoice revenue on both sides, keeping tips, fees and tax out. */
export function invoiceBonusRevenue(invoice: BonusInvoice): number {
  const subtotal = Number(invoice.subtotal || 0)
  const nonServiceRevenue = (invoice.ops_invoice_line_items || []).reduce(
    (sum, line) => {
      if (line.excluded_at) return sum
      const catalog = unwrap(line.service_catalog_items)
      const name = normalize(catalog?.name || line.description)
      const slug = normalize(catalog?.slug)
      return ['gratuity', 'card-fee', 'mileage-travel'].includes(slug) ||
        /^(gratuity|tip|card fee|mileage\/ ?travel)$/.test(name)
        ? sum + Number(line.line_total || 0)
        : sum
    },
    0,
  )
  return (
    Math.round(
      (Math.max(
        0,
        subtotal -
          nonServiceRevenue -
          Number(invoice.discount_amount || 0) -
          Number(invoice.percentage_discount_amount || 0),
      ) +
        Math.max(0, Number(invoice.minimum_charge_adjustment || 0))) *
        100,
    ) / 100
  )
}

export function invoiceGrowthRevenue(
  baseline: number,
  current: number,
): number {
  return Math.round(Math.max(0, current - baseline) * 100) / 100
}

function bonusIdBatches(ids: string[]): string[][] {
  const batches: string[][] = []
  for (let index = 0; index < ids.length; index += 50) {
    batches.push(ids.slice(index, index + 50))
  }
  return batches
}

export async function loadAddOnBonuses(
  supabase: AdminClient,
  options: { startDate: string; endDate: string; staffUserId?: string },
): Promise<AddOnBonusSummary> {
  const appointmentQuery = supabase
    .from('ops_appointments')
    .select(
      `
        id,
        appointment_date,
        invoice_growth_baseline_total,
        invoice_growth_bonus_staff_user_id,
        invoice_growth_bonus_rate,
        ops_customers!ops_appointments_customer_id_fkey (
          full_name,
          business_name
        )
      `,
    )
    .gte('appointment_date', options.startDate)
    .lte('appointment_date', options.endDate)
    .order('id', { ascending: true })
  const firstPage = await appointmentQuery.range(0, 999)
  if (firstPage.error) throw firstPage.error
  const appointments = firstPage.data || []
  let pageLength = appointments.length
  for (let offset = 1000; pageLength === 1000; offset += 1000) {
    const page = await appointmentQuery.range(offset, offset + 999)
    if (page.error) throw page.error
    appointments.push(...(page.data || []))
    pageLength = page.data?.length || 0
  }
  const appointmentIds = appointments.map((row) => row.id)
  if (appointmentIds.length === 0) {
    return { rows: [], earnedBonus: 0, pendingBonus: 0, eligibleRevenue: 0 }
  }

  const lineResults = await Promise.all(
    bonusIdBatches(appointmentIds).map((ids) => {
      let query = supabase
        .from('ops_appointment_line_items')
        .select(
          'id, appointment_id, line_total, add_on_bonus_staff_user_id, add_on_bonus_category, add_on_bonus_rate',
        )
        .in('appointment_id', ids)
        .not('add_on_bonus_staff_user_id', 'is', null)
        .is('excluded_at', null)
      if (options.staffUserId) {
        query = query.eq('add_on_bonus_staff_user_id', options.staffUserId)
      }
      return query
    }),
  )
  for (const result of lineResults) {
    if (result.error) throw result.error
  }
  const lines = lineResults.flatMap((result) => result.data || [])
  const growthAppointments = appointments.filter(
    (appointment) =>
      appointment.invoice_growth_baseline_total != null &&
      appointment.invoice_growth_bonus_staff_user_id &&
      Number(appointment.invoice_growth_bonus_rate || 0) > 0 &&
      (!options.staffUserId ||
        appointment.invoice_growth_bonus_staff_user_id === options.staffUserId),
  )
  if (!lines.length && !growthAppointments.length) {
    return { rows: [], earnedBonus: 0, pendingBonus: 0, eligibleRevenue: 0 }
  }

  const staffIds = [
    ...new Set([
      ...lines.map((line) => line.add_on_bonus_staff_user_id as string),
      ...growthAppointments.map(
        (appointment) =>
          appointment.invoice_growth_bonus_staff_user_id as string,
      ),
    ]),
  ]
  const bonusAppointmentIds = [
    ...new Set([
      ...lines.map((line) => line.appointment_id),
      ...growthAppointments.map((appointment) => appointment.id),
    ]),
  ]
  const [staffResult, invoiceResults] = await Promise.all([
    supabase.from('staff_users').select('id, display_name').in('id', staffIds),
    Promise.all(
      bonusIdBatches(bonusAppointmentIds).map((ids) =>
        supabase
          .from('ops_invoices')
          .select(INVOICE_BONUS_SELECT)
          .in('appointment_id', ids)
          .order('created_at', { ascending: false }),
      ),
    ),
  ])
  if (staffResult.error) throw staffResult.error
  for (const result of invoiceResults) {
    if (result.error) throw result.error
  }
  const staff = staffResult.data || []
  const invoices = invoiceResults.flatMap((result) => result.data || [])

  const appointmentById = new Map(
    (appointments || []).map((row) => [row.id, row]),
  )
  const staffById = new Map(
    (staff || []).map((row) => [row.id, row.display_name]),
  )
  const invoiceByAppointment = new Map<string, (typeof invoices)[number]>()
  for (const invoice of invoices || []) {
    if (!invoiceByAppointment.has(invoice.appointment_id)) {
      invoiceByAppointment.set(invoice.appointment_id, invoice)
    }
  }

  const grouped = new Map<
    string,
    {
      appointmentId: string
      staffUserId: string
      category: AddOnBonusCategory
      rate: number
      lineRevenue: number
    }
  >()

  for (const line of lines) {
    // A dollar-growth job replaces its category bonuses, never stacks with them.
    if (
      appointmentById.get(line.appointment_id)?.invoice_growth_baseline_total !=
      null
    )
      continue
    const category = line.add_on_bonus_category as AddOnBonusCategory | null
    const staffUserId = line.add_on_bonus_staff_user_id as string | null
    if (!category || !staffUserId) continue
    const key = `${line.appointment_id}:${staffUserId}:${category}`
    const existing = grouped.get(key) || {
      appointmentId: line.appointment_id,
      staffUserId,
      category,
      rate: Number(line.add_on_bonus_rate || 0),
      lineRevenue: 0,
    }
    existing.lineRevenue += Number(line.line_total || 0)
    grouped.set(key, existing)
  }

  const rows: AddOnBonusRow[] = []
  for (const [key, group] of grouped) {
    const appointment = appointmentById.get(group.appointmentId)
    if (!appointment) continue
    const invoice = invoiceByAppointment.get(group.appointmentId)
    const customer = unwrap(appointment.ops_customers)
    const eligibleRevenue = discountedEligibleRevenue(
      group.lineRevenue,
      Number(invoice?.subtotal || 0),
      Number(invoice?.discount_amount || 0),
      Number(invoice?.percentage_discount_amount || 0),
    )
    const bonusAmount = Math.round(eligibleRevenue * group.rate * 100) / 100

    rows.push({
      key,
      appointmentId: group.appointmentId,
      appointmentDate: appointment.appointment_date,
      staffUserId: group.staffUserId,
      staffName: staffById.get(group.staffUserId) || 'Unknown technician',
      customerName:
        customer?.business_name?.trim() ||
        customer?.full_name?.trim() ||
        'Customer',
      category: group.category,
      categoryLabel: ADD_ON_BONUS_CATEGORY_LABELS[group.category],
      eligibleRevenue,
      bonusRate: group.rate,
      bonusAmount,
      status: invoice?.payment_status === 'paid' ? 'earned' : 'pending',
    })
  }

  for (const appointment of growthAppointments) {
    const invoice = invoiceByAppointment.get(appointment.id)
    if (!invoice) throw new Error('Invoice missing for bonus calculation')
    const eligibleRevenue = invoiceGrowthRevenue(
      Number(appointment.invoice_growth_baseline_total),
      invoiceBonusRevenue(invoice),
    )
    if (eligibleRevenue <= 0) continue
    const staffUserId = appointment.invoice_growth_bonus_staff_user_id as string
    const rate = Number(appointment.invoice_growth_bonus_rate)
    const customer = unwrap(appointment.ops_customers)
    rows.push({
      key: `${appointment.id}:${staffUserId}:invoice_growth`,
      appointmentId: appointment.id,
      appointmentDate: appointment.appointment_date,
      staffUserId,
      staffName: staffById.get(staffUserId) || 'Unknown technician',
      customerName:
        customer?.business_name?.trim() ||
        customer?.full_name?.trim() ||
        'Customer',
      category: 'invoice_growth',
      categoryLabel: 'Above original invoice',
      eligibleRevenue,
      bonusRate: rate,
      bonusAmount: Math.round(eligibleRevenue * rate * 100) / 100,
      status: invoice.payment_status === 'paid' ? 'earned' : 'pending',
    })
  }

  rows.sort(
    (a, b) =>
      b.appointmentDate.localeCompare(a.appointmentDate) ||
      a.customerName.localeCompare(b.customerName),
  )

  return {
    rows,
    earnedBonus:
      Math.round(
        rows
          .filter((row) => row.status === 'earned')
          .reduce((sum, row) => sum + row.bonusAmount, 0) * 100,
      ) / 100,
    pendingBonus:
      Math.round(
        rows
          .filter((row) => row.status === 'pending')
          .reduce((sum, row) => sum + row.bonusAmount, 0) * 100,
      ) / 100,
    eligibleRevenue:
      Math.round(
        rows.reduce((sum, row) => sum + row.eligibleRevenue, 0) * 100,
      ) / 100,
  }
}
