/**
 * Fiber check — runs before a rug or upholstery item is cleaned.
 *
 * POST { lineItemId, itemLabel, hasTag, images: dataUrl[], techNotes?, burnResult? }
 *   → { check }
 *
 * Photos are uploaded to storage and RETAINED. The Foreman diagnostic endpoint
 * discards its photos (`photo_urls: []`), which is exactly what you need and
 * do not have when a claim is filed months later.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getAssignedTechAppointment } from '@/lib/tech/appointments'
import { createAdminClient } from '@/supabase/server'
import { analyzeFiber } from '@/lib/fiber/analyze'
import type { BurnBucket } from '@/lib/fiber/stop-list'
import { fiberItemKind } from '@/lib/fiber/requires-check'

export const maxDuration = 60

const MAX_IMAGES = 4
const BURN_BUCKETS: BurnBucket[] = [
  'melts',
  'burning_hair',
  'burns_like_paper',
]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let access
  try {
    access = await requireAnyRole(['admin', 'owner', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const { id: appointmentId } = await params
    const staffUserId = access.staff?.id ?? access.id
    const appointment = await getAssignedTechAppointment(
      supabase,
      staffUserId,
      appointmentId,
    )
    if (!appointment) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json()
    const lineItemId: string | null = body.lineItemId
      ? String(body.lineItemId)
      : null
    const itemLabel = String(body.itemLabel || '').trim() || 'Item'
    const hasTag = body.hasTag === true
    const techNotes =
      typeof body.techNotes === 'string' ? body.techNotes.trim() : null
    const burnResult: BurnBucket | null = BURN_BUCKETS.includes(body.burnResult)
      ? body.burnResult
      : null
    const images: string[] = Array.isArray(body.images)
      ? body.images.filter((i: unknown) => typeof i === 'string').slice(0, MAX_IMAGES)
      : []

    if (images.length === 0 && !burnResult) {
      return NextResponse.json(
        { error: 'At least one photo or a burn test result is required' },
        { status: 400 },
      )
    }

    const line = lineItemId
      ? appointment.lineItems.find((l) => l.id === lineItemId)
      : null

    // Upload first so the evidence survives even if the analysis call fails.
    const photoUrls: string[] = []
    for (const [index, dataUrl] of images.entries()) {
      const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl)
      if (!match) continue
      const [, contentType, base64] = match
      const extension = contentType.split('/')[1] ?? 'jpg'
      const fileName = `fiber-checks/${appointmentId}/${Date.now()}_${index}.${extension}`
      const { data: uploaded, error: uploadError } = await supabase.storage
        .from('job-images')
        .upload(fileName, Buffer.from(base64, 'base64'), {
          contentType,
          cacheControl: '3600',
        })
      if (uploadError) {
        console.error('[fiber-check] photo upload failed:', uploadError)
        continue
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from('job-images').getPublicUrl(uploaded.path)
      photoUrls.push(publicUrl)
    }

    const analysis = await analyzeFiber({
      images,
      itemKind: fiberItemKind({ name: line?.name ?? itemLabel }),
      itemLabel: line?.name ?? itemLabel,
      techNotes,
      burnResult,
      hasTag,
    })

    const { data: inserted, error: insertError } = await supabase
      .from('fiber_checks')
      .insert({
        appointment_id: appointmentId,
        appointment_line_item_id: lineItemId,
        item_label: line?.name ?? itemLabel,
        checked_by: access.id,
        checked_by_label: access.staff?.display_name ?? access.email,
        verdict: analysis.verdict,
        determined_by: analysis.determinedBy,
        fiber: analysis.fiber,
        confidence: analysis.confidence,
        has_tag: hasTag,
        tag_text: analysis.tagText || null,
        burn_result: burnResult ?? 'not_tested',
        photo_urls: photoUrls,
        warnings: analysis.warnings,
        recommended_method: analysis.recommendedMethod,
        ai_response: analysis.raw,
      })
      .select('*')
      .single()

    if (insertError) throw insertError

    // Return the refreshed appointment so the signature gate clears without a
    // page reload.
    const updatedAppointment = await getAssignedTechAppointment(
      supabase,
      staffUserId,
      appointmentId,
    )

    return NextResponse.json({
      appointment: updatedAppointment,
      check: {
        id: inserted.id,
        appointmentLineItemId: inserted.appointment_line_item_id,
        itemLabel: inserted.item_label,
        verdict: analysis.verdict,
        determinedBy: analysis.determinedBy,
        fiber: analysis.fiber,
        confidence: analysis.confidence,
        warnings: analysis.warnings,
        recommendedMethod: analysis.recommendedMethod,
        nextTest: analysis.nextTest,
        summary: analysis.summary,
        tagText: analysis.tagText,
        photoUrls,
        createdAt: inserted.created_at,
      },
    })
  } catch (error) {
    console.error('[tech/appointments/:id/fiber-check][POST]', error)
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: `Fiber check failed: ${detail.slice(0, 200)}` },
      { status: 500 },
    )
  }
}
