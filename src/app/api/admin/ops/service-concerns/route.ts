import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  SERVICE_CONCERN_CATEGORIES,
  SERVICE_CONCERN_STATUSES,
  type ServiceConcernCategory,
  type ServiceConcernStatus,
} from '@/lib/ops/service-concerns'
import { createAdminClient } from '@/supabase/server'

const CONCERN_SELECT = `
  id,
  customer_id,
  appointment_id,
  conversation_id,
  status,
  category,
  source,
  initial_message,
  internal_notes,
  resolution_notes,
  intake_sms_sent_at,
  last_customer_message_at,
  resolved_at,
  created_at,
  updated_at,
  ops_customers!ops_service_concerns_customer_id_fkey (
    full_name,
    business_name,
    phone,
    email
  ),
  ops_appointments!ops_service_concerns_appointment_id_fkey (
    appointment_date,
    completed_at,
    status,
    ops_service_addresses (
      street_1,
      city,
      state,
      zip_code
    )
  )
`

function isAllowedStatus(value: unknown): value is ServiceConcernStatus {
  return SERVICE_CONCERN_STATUSES.includes(value as ServiceConcernStatus)
}

function isAllowedCategory(value: unknown): value is ServiceConcernCategory {
  return SERVICE_CONCERN_CATEGORIES.includes(value as ServiceConcernCategory)
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 5000) : null
}

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const supabase = createAdminClient()
    const { data: concerns, error } = await supabase
      .from('ops_service_concerns')
      .select(CONCERN_SELECT)
      .order('updated_at', { ascending: false })
      .limit(200)
    if (error) throw error

    const concernIds = (concerns || []).map((concern) => concern.id)
    const mediaByConcern = new Map<string, Array<Record<string, unknown>>>()
    if (concernIds.length > 0) {
      const { data: mediaRows, error: mediaError } = await supabase
        .from('ops_customer_media')
        .select(
          'id, service_concern_id, storage_path, content_type, status, created_at',
        )
        .in('service_concern_id', concernIds)
        .order('created_at', { ascending: true })
      if (mediaError) throw mediaError

      await Promise.all(
        (mediaRows || []).map(async (media) => {
          let signedUrl: string | null = null
          if (media.status === 'available' && media.storage_path) {
            const { data } = await supabase.storage
              .from('customer-media')
              .createSignedUrl(media.storage_path, 60 * 60)
            signedUrl = data?.signedUrl || null
          }
          if (!media.service_concern_id) return
          const rows = mediaByConcern.get(media.service_concern_id) || []
          rows.push({
            id: media.id,
            contentType: media.content_type,
            status: media.status,
            createdAt: media.created_at,
            signedUrl,
          })
          mediaByConcern.set(media.service_concern_id, rows)
        }),
      )
    }

    return NextResponse.json({
      concerns: (concerns || []).map((concern) => ({
        ...concern,
        media: mediaByConcern.get(concern.id) || [],
      })),
    })
  } catch (error) {
    console.error('[ops/service-concerns][GET] Error:', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: 'Failed to load service concerns' },
      { status },
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const body = (await request.json()) as Record<string, unknown>
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) {
      return NextResponse.json(
        { error: 'Concern id is required' },
        { status: 400 },
      )
    }
    if (!isAllowedStatus(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    if (!isAllowedCategory(body.category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const terminal = body.status === 'resolved' || body.status === 'declined'
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('ops_service_concerns')
      .update({
        status: body.status,
        category: body.category,
        internal_notes: textOrNull(body.internal_notes),
        resolution_notes: textOrNull(body.resolution_notes),
        resolved_at: terminal ? now : null,
        updated_at: now,
      })
      .eq('id', id)
      .select(CONCERN_SELECT)
      .maybeSingle()
    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: 'Concern not found' }, { status: 404 })
    }

    return NextResponse.json({ concern: data })
  } catch (error) {
    console.error('[ops/service-concerns][PATCH] Error:', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: 'Failed to update service concern' },
      { status },
    )
  }
}
