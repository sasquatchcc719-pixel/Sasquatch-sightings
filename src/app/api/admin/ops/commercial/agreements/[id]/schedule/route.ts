import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { type AgreementContent } from '@/lib/ops/commercial'
import { previewDates, type RecurrenceRule } from '@/lib/ops/recurring'
const schema = z.object({
  operation_id: z.uuid(),
  line_ids: z.array(z.uuid()).min(1).max(100),
  label: z.string().trim().min(1).max(200),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'custom']),
  interval_days: z.number().int().min(1).max(366),
  start_date: z.iso.date(),
  end_date: z.union([z.iso.date(), z.literal('')]),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  duration: z.number().int().min(15).max(720),
  invoice_mode: z.enum(['per_visit', 'batch_monthly']),
  preview: z.boolean().optional(),
})
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const body = schema.parse(await request.json())
    const db = createAdminClient()
    const { data: a } = await db
      .from('ops_commercial_agreements')
      .select('content,status')
      .eq('id', id)
      .single()
    if (!a || a.status !== 'signed')
      throw new Error(
        'A signed agreement is required to create a service plan.',
      )
    const c = a.content as AgreementContent
    if (!c.service_address_id)
      throw new Error('The agreement needs a saved service address.')
    if (
      body.start_date < c.effective_from ||
      (body.end_date && body.end_date < body.start_date) ||
      (c.effective_until &&
        (body.start_date > c.effective_until ||
          !body.end_date ||
          body.end_date > c.effective_until))
    )
      throw new Error('Keep the service plan dates within the agreement term.')
    const lines = c.lines.filter((l) => body.line_ids.includes(l.id))
    if (
      lines.length !== new Set(body.line_ids).size ||
      lines.some((l) => l.phase !== 'recurring')
    )
      throw new Error('Select recurring services from this signed agreement.')
    const start = new Date(body.start_date + 'T12:00:00')
    const rule = {
      frequency: body.frequency,
      day_of_week: ['weekly', 'biweekly'].includes(body.frequency)
        ? start.getDay()
        : null,
      day_of_month: body.frequency === 'monthly' ? start.getDate() : null,
      week_of_month: null,
      interval_days: body.frequency === 'custom' ? body.interval_days : null,
      effective_from: body.start_date,
      effective_until: body.end_date || null,
      override_start_time: null,
    }
    const dates = previewDates([rule as RecurrenceRule], 8)
    if (body.preview) return NextResponse.json({ dates })
    const { data, error } = await db.rpc('create_commercial_service_plan', {
      p_id: body.operation_id,
      p_agreement_id: id,
      p_rule: rule,
      p_template: {
        service_address_id: c.service_address_id,
        label: body.label,
        start_time: body.start_time,
        scheduled_duration_minutes: body.duration,
        invoice_mode: body.invoice_mode,
        line_items: lines.map((l) => ({
          name_snapshot: l.name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          service_catalog_item_id: l.service_catalog_item_id,
          pricing_unit_snapshot: l.unit,
          length_value: l.length_value,
          width_value: l.width_value,
          area_segments: l.area_segments,
          duration_minutes: 0,
          notes: [l.area, l.method, l.service_window, l.notes]
            .filter(Boolean)
            .join('\n'),
        })),
      },
    })
    if (error) throw error
    return NextResponse.json({ id: data, dates, paused: true }, { status: 201 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to save service plan' },
      {
        status:
          e instanceof Error && e.message === 'Not authorized' ? 403 : 400,
      },
    )
  }
}
