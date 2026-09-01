import { SupabaseClient } from '@supabase/supabase-js'
import type { DryingReportData } from '@/lib/ops/pdf/drying-report'

const VISIT_LABELS: Record<string, string> = {
  mitigation: 'Mitigation',
  monitor: 'Monitoring visit',
  final: 'Final visit',
}

export type RestorationProjectCustomer = {
  full_name: string | null
  business_name: string | null
  phone: string | null
  email: string | null
  email_opt_out: boolean | null
}

/**
 * Everything the drying report PDF needs, built once so the on-screen
 * download and the emailed copy can never quietly diverge.
 */
export async function buildDryingReportData(
  supabase: SupabaseClient,
  projectId: string,
  includePhotos: boolean,
): Promise<{
  data: DryingReportData
  customer: RestorationProjectCustomer | null
} | null> {
  const { data: project } = await supabase
    .from('restoration_projects')
    .select(
      `*,
       ops_customers!restoration_projects_customer_id_fkey ( full_name, business_name, phone, email, email_opt_out ),
       ops_service_addresses ( street_1, street_2, city, state, zip_code )`,
    )
    .eq('id', projectId)
    .maybeSingle()

  if (!project) return null

  const customer = (
    Array.isArray(project.ops_customers)
      ? project.ops_customers[0]
      : project.ops_customers
  ) as RestorationProjectCustomer | null
  const address = Array.isArray(project.ops_service_addresses)
    ? project.ops_service_addresses[0]
    : project.ops_service_addresses

  const { data: visits } = await supabase
    .from('ops_appointments')
    .select(
      `id, appointment_date, visit_type, visit_sequence, restoration_visit_note,
       ops_appointment_line_items ( name_snapshot, quantity, line_total, pricing_unit_snapshot )`,
    )
    .eq('restoration_project_id', projectId)
    .order('visit_sequence', { nullsFirst: false })

  const visitIds = (visits ?? []).map((v) => v.id)

  const [
    { data: equipment },
    { data: points },
    { data: air },
    { data: categoryEvents },
    { data: payments },
    { data: photos },
  ] = await Promise.all([
    supabase
      .from('restoration_equipment_billing')
      .select('catalog_code, description, units, unit_days, line_total')
      .eq('project_id', projectId),
    supabase
      .from('restoration_reading_points')
      .select(
        'label, material, dry_standard, restoration_readings ( value, taken_at )',
      )
      .eq('project_id', projectId)
      .is('retired_at', null),
    supabase
      .from('restoration_air_readings')
      .select('role, location, temp_f, rh_pct, taken_at')
      .eq('project_id', projectId)
      .order('taken_at'),
    supabase
      .from('restoration_category_events')
      .select('water_category, effective_at, reason')
      .eq('project_id', projectId)
      .order('effective_at'),
    visitIds.length
      ? supabase
          .from('ops_payments')
          .select('amount_cents')
          .in('appointment_id', visitIds)
      : Promise.resolve({ data: [] as Array<{ amount_cents: number }> }),
    visitIds.length
      ? supabase
          .from('ops_job_photos')
          .select('public_url, restoration_phase')
          .in('appointment_id', visitIds)
          .order('created_at')
      : Promise.resolve({
          data: [] as Array<{
            public_url: string
            restoration_phase: string | null
          }>,
        }),
  ])

  const work = (visits ?? []).reduce((sum, visit) => {
    const lines = (visit.ops_appointment_line_items ?? []) as Array<{
      line_total: number
    }>
    return sum + lines.reduce((s, l) => s + Number(l.line_total), 0)
  }, 0)
  const equipmentTotal = (equipment ?? []).reduce(
    (s, e) => s + Number(e.line_total),
    0,
  )
  const paid =
    ((payments ?? []) as Array<{ amount_cents: number }>).reduce(
      (s, p) => s + Number(p.amount_cents),
      0,
    ) / 100

  // Same clamping as getRestorationBalanceCents and the project detail route
  // — the split can never exceed what's actually owed, and must stay in sync
  // with both or the report and the screen quote different balances.
  const grossSubtotal = Math.round((work + equipmentTotal) * 100) / 100
  const deductibleCredit = Math.max(
    0,
    Math.min(grossSubtotal, Number(project.deductible_credit ?? 0) || 0),
  )
  const netSubtotal = Math.round((grossSubtotal - deductibleCredit) * 100) / 100

  const data: DryingReportData = {
    company: {
      // Canonical public NAP — must stay identical everywhere it appears.
      name: 'Sasquatch Carpet Cleaning',
      phone: '(719) 249-8791',
      email: 'sasquatchcc719@gmail.com',
      web: 'sasquatchcarpet.com',
    },
    customer: {
      name: customer?.business_name || customer?.full_name || 'Customer',
      phone: customer?.phone ?? null,
    },
    address: address
      ? `${address.street_1}${address.street_2 ? `, ${address.street_2}` : ''}, ${address.city}, ${address.state} ${address.zip_code}`
      : '',
    loss: {
      category: project.water_category,
      categoryHistory: (categoryEvents ?? []).map((e) => ({
        category: Number(e.water_category),
        effectiveAt: String(e.effective_at),
        reason: e.reason ?? null,
      })),
      source: project.source_of_loss,
      lossDate: project.loss_date,
      narrative: project.cause_narrative,
      afterHours: Boolean(project.after_hours_call),
      carrier: project.carrier,
      claimNumber: project.claim_number,
    },
    visits: (visits ?? []).map((visit) => ({
      label: VISIT_LABELS[String(visit.visit_type)] ?? 'Visit',
      date: String(visit.appointment_date),
      note:
        (visit as { restoration_visit_note?: string | null })
          .restoration_visit_note ?? null,
      lines: (
        (visit.ops_appointment_line_items ?? []) as Array<{
          name_snapshot: string
          quantity: number
          line_total: number
          pricing_unit_snapshot: string | null
        }>
      ).map((line) => ({
        description: line.name_snapshot,
        quantity: Number(line.quantity),
        unit: line.pricing_unit_snapshot,
        total: Number(line.line_total),
      })),
    })),
    equipment: (equipment ?? []).map((e) => ({
      code: String(e.catalog_code),
      description: String(e.description),
      units: Number(e.units),
      unitDays: Number(e.unit_days),
      total: Number(e.line_total),
    })),
    readingPoints: (points ?? []).map((point) => ({
      label: String(point.label),
      material: point.material ?? null,
      dryStandard:
        point.dry_standard != null ? Number(point.dry_standard) : null,
      readings: (
        (point.restoration_readings ?? []) as Array<{
          value: number
          taken_at: string
        }>
      )
        .map((r) => ({ value: Number(r.value), takenAt: String(r.taken_at) }))
        .sort(
          (a, b) =>
            new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime(),
        ),
    })),
    airReadings: (air ?? []).map((r) => ({
      role: (r as { role?: string | null }).role ?? null,
      location: String(r.location),
      tempF: r.temp_f != null ? Number(r.temp_f) : null,
      rhPct: r.rh_pct != null ? Number(r.rh_pct) : null,
      takenAt: String(r.taken_at),
    })),
    photos: (
      (photos ?? []) as Array<{
        public_url: string
        restoration_phase: string | null
      }>
    ).map((p) => ({ url: p.public_url, phase: p.restoration_phase })),
    totals: {
      work: Math.round(work * 100) / 100,
      equipment: Math.round(equipmentTotal * 100) / 100,
      grossSubtotal,
      deductibleCredit,
      subtotal: netSubtotal,
      paid,
      balance: Math.round((netSubtotal - paid) * 100) / 100,
    },
    includePhotos,
  }

  return { data, customer }
}
