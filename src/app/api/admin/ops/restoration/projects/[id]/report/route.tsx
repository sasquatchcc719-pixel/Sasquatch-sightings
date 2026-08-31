import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { DryingReportPDF, type DryingReportData } from '@/lib/ops/pdf/drying-report'

const VISIT_LABELS: Record<string, string> = {
  mitigation: 'Mitigation',
  monitor: 'Monitoring visit',
  final: 'Final visit',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()

    const { data: project } = await supabase
      .from('restoration_projects')
      .select(
        `*,
         ops_customers!restoration_projects_customer_id_fkey ( full_name, business_name, phone ),
         ops_service_addresses ( street_1, street_2, city, state, zip_code )`,
      )
      .eq('id', id)
      .maybeSingle()

    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 })

    const customer = Array.isArray(project.ops_customers)
      ? project.ops_customers[0]
      : project.ops_customers
    const address = Array.isArray(project.ops_service_addresses)
      ? project.ops_service_addresses[0]
      : project.ops_service_addresses

    const { data: visits } = await supabase
      .from('ops_appointments')
      .select(
        `id, appointment_date, visit_type, visit_sequence, restoration_visit_note,
         ops_appointment_line_items ( name_snapshot, quantity, line_total, pricing_unit_snapshot )`,
      )
      .eq('restoration_project_id', id)
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
        .eq('project_id', id),
      supabase
        .from('restoration_reading_points')
        .select('label, material, dry_standard, restoration_readings ( value, taken_at )')
        .eq('project_id', id)
        .is('retired_at', null),
      supabase
        .from('restoration_air_readings')
        .select('location, temp_f, rh_pct, taken_at')
        .eq('project_id', id)
        .order('taken_at'),
      supabase
        .from('restoration_category_events')
        .select('water_category, effective_at, reason')
        .eq('project_id', id)
        .order('effective_at'),
      visitIds.length
        ? supabase.from('ops_payments').select('amount_cents').in('appointment_id', visitIds)
        : Promise.resolve({ data: [] as Array<{ amount_cents: number }> }),
      visitIds.length
        ? supabase
            .from('ops_job_photos')
            .select('public_url, restoration_phase')
            .in('appointment_id', visitIds)
            .order('created_at')
        : Promise.resolve({ data: [] as Array<{ public_url: string; restoration_phase: string | null }> }),
    ])

    const work = (visits ?? []).reduce((sum, visit) => {
      const lines = (visit.ops_appointment_line_items ?? []) as Array<{ line_total: number }>
      return sum + lines.reduce((s, l) => s + Number(l.line_total), 0)
    }, 0)
    const equipmentTotal = (equipment ?? []).reduce((s, e) => s + Number(e.line_total), 0)
    const paid =
      ((payments ?? []) as Array<{ amount_cents: number }>).reduce(
        (s, p) => s + Number(p.amount_cents),
        0,
      ) / 100

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
        note: (visit as { restoration_visit_note?: string | null }).restoration_visit_note ?? null,
        lines: ((visit.ops_appointment_line_items ?? []) as Array<{
          name_snapshot: string
          quantity: number
          line_total: number
          pricing_unit_snapshot: string | null
        }>).map((line) => ({
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
        dryStandard: point.dry_standard != null ? Number(point.dry_standard) : null,
        readings: ((point.restoration_readings ?? []) as Array<{ value: number; taken_at: string }>)
          .map((r) => ({ value: Number(r.value), takenAt: String(r.taken_at) }))
          .sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime()),
      })),
      airReadings: (air ?? []).map((r) => ({
        location: String(r.location),
        tempF: r.temp_f != null ? Number(r.temp_f) : null,
        rhPct: r.rh_pct != null ? Number(r.rh_pct) : null,
        takenAt: String(r.taken_at),
      })),
      photos: ((photos ?? []) as Array<{ public_url: string; restoration_phase: string | null }>).map(
        (p) => ({ url: p.public_url, phase: p.restoration_phase }),
      ),
      totals: {
        work: Math.round(work * 100) / 100,
        equipment: Math.round(equipmentTotal * 100) / 100,
        subtotal: Math.round((work + equipmentTotal) * 100) / 100,
        paid,
        balance: Math.round((work + equipmentTotal - paid) * 100) / 100,
      },
      includePhotos: request.nextUrl.searchParams.get('photos') !== '0',
    }

    // A single unreachable photo must not cost the whole report. If the render
    // fails with images in, fall back to the same document without them rather
    // than handing back an error.
    let buffer: Buffer
    try {
      buffer = Buffer.from(await renderToBuffer(<DryingReportPDF data={data} />))
    } catch (renderError) {
      console.error('[restoration/report] retrying without photos:', renderError)
      buffer = Buffer.from(
        await renderToBuffer(<DryingReportPDF data={{ ...data, includePhotos: false }} />),
      )
    }

    const safeName = (data.customer.name || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="drying-report-${safeName}.pdf"`,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to build report'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
