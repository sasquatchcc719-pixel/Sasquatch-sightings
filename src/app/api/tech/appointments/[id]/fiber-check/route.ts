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
import { getTechAppointmentForAccess } from '@/lib/tech/appointments'
import { createAdminClient } from '@/supabase/server'
import { analyzeFiber } from '@/lib/fiber/analyze'
import type { BurnBucket } from '@/lib/fiber/stop-list'
import { fiberItemKind } from '@/lib/fiber/requires-check'
import {
  blockedSummary,
  signatureAllowed,
  unitsForLine,
} from '@/lib/fiber/gate'
import {
  sendTelegramNotification,
  sendTelegramPhoto,
} from '@/lib/telegram'

export const maxDuration = 60

const MAX_IMAGES = 4
const BURN_BUCKETS: BurnBucket[] = [
  'melts',
  'burning_hair',
  'burns_like_paper',
]

/** Gate state for a job — used by the admin invoice screen, which keeps its
 * own line-item state and has no fiber data of its own. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let access
  try {
    access = await requireAnyRole(['admin', 'owner', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { id: appointmentId } = await params
  const appointment = await getTechAppointmentForAccess(supabase, {
    role: access.role,
    staffId: access.staff?.id ?? null,
    appointmentId,
  })
  if (!appointment) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const gateLines = appointment.lineItems.map((line) => ({
    id: line.id,
    name: line.name,
    quantity: line.quantity,
    catalogCategory: line.catalogCategory,
    catalogPricingUnit: line.catalogPricingUnit,
    excludedAt: line.excludedAt,
  }))
  const gateChecks = appointment.fiberChecks.map((check) => ({
    appointmentLineItemId: check.appointmentLineItemId,
    unitIndex: check.unitIndex ?? 1,
    verdict: check.verdict,
  }))

  return NextResponse.json({
    lines: appointment.lineItems,
    checks: appointment.fiberChecks,
    allowed: signatureAllowed(gateLines, gateChecks),
    blocked: blockedSummary(gateLines, gateChecks),
  })
}

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
    const appointment = await getTechAppointmentForAccess(supabase, {
      role: access.role,
      staffId: access.staff?.id ?? null,
      appointmentId,
    })
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

    // A line can cover several physical pieces ("Area Rug 8x11" x3) and they
    // are often different fibers, so each piece is checked separately.
    const unitsRequired = line ? unitsForLine(line) : 1
    const unitIndex = Math.min(
      unitsRequired,
      Math.max(1, Math.floor(Number(body.unitIndex) || 1)),
    )

    // Upload first so the evidence survives even if the analysis call fails.
    const photoUrls: string[] = []
    const storedPaths: string[] = []
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
      storedPaths.push(uploaded.path)
    }

    const analysis = await analyzeFiber({
      images,
      itemKind: fiberItemKind({ name: line?.name ?? itemLabel }),
      itemLabel: line?.name ?? itemLabel,
      techNotes,
      burnResult,
      hasTag,
    })

    // Re-checking a piece replaces its verdict rather than stacking a second
    // row, which would otherwise let three checks on one rug satisfy a line
    // covering three rugs.
    if (lineItemId) {
      await supabase
        .from('fiber_checks')
        .delete()
        .eq('appointment_line_item_id', lineItemId)
        .eq('unit_index', unitIndex)
    }

    const { data: inserted, error: insertError } = await supabase
      .from('fiber_checks')
      .insert({
        appointment_id: appointmentId,
        appointment_line_item_id: lineItemId,
        unit_index: unitIndex,
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
        decision_trail: analysis.trail,
        research_notes: analysis.researchNotes,
      })
      .select('*')
      .single()

    if (insertError) throw insertError

    // File the photos into the job's own photo set as well, so a year from now
    // the tag shot sits with everything else from that job instead of only
    // inside the fiber check record. Labelled 'fiber_check' so nothing that
    // publishes job photos can pick it up.
    if (storedPaths.length > 0) {
      const { error: photoFileError } = await supabase
        .from('ops_job_photos')
        .insert(
          storedPaths.map((path, index) => ({
            appointment_id: appointmentId,
            storage_path: path,
            public_url: photoUrls[index],
            label: 'fiber_check',
            watermarked: false,
            source: 'staff',
            uploaded_by_label: access.staff?.display_name ?? access.email,
            original_filename: `${line?.name ?? itemLabel} — fiber check`,
          })),
        )
      if (photoFileError) {
        // Never fail the check over filing: the fiber_checks row already holds
        // these URLs, so the evidence is not lost.
        console.error('[fiber-check] could not file job photos:', photoFileError)
      }
    }

    // Keep the photos with the rest of the job's photos too, so a year from
    // now the tag shot sits alongside everything else from that job instead of
    // only inside the fiber check record. Labelled 'fiber_check' so it is
    // excluded from the customer's invoice email and from public job posts.
    if (storedPaths.length > 0) {
      const { error: photoFileError } = await supabase
        .from('ops_job_photos')
        .insert(
          storedPaths.map((path, index) => ({
            appointment_id: appointmentId,
            storage_path: path,
            public_url: photoUrls[index],
            label: 'fiber_check',
            watermarked: false,
            source: 'staff',
            uploaded_by_label: access.staff?.display_name ?? access.email,
            original_filename: `${line?.name ?? itemLabel} — fiber check`,
          })),
        )
      if (photoFileError) {
        // Never fail the check over filing. The fiber_checks row already holds
        // these URLs, so the evidence is not lost either way.
        console.error('[fiber-check] could not file job photos:', photoFileError)
      }
    }

    // Every identification is reported, not just the refusals. The tool is new
    // and unproven in the field, so Charles watches each call — the photo the
    // tech shot alongside what the model made of it — to catch a bad read
    // before it becomes a damaged rug.
    void reportCheck({
      itemLabel: line?.name ?? itemLabel,
      unitIndex,
      unitsRequired,
      customerName: appointment.customerName,
      appointmentDate: appointment.appointmentDate,
      checkedBy: access.staff?.display_name ?? access.email,
      verdict: analysis.verdict,
      determinedBy: analysis.determinedBy,
      fiber: analysis.fiber,
      confidence: analysis.confidence,
      tagText: analysis.tagText,
      burnResult,
      summary: analysis.summary,
      warnings: analysis.warnings,
      recommendedMethod: analysis.recommendedMethod,
      trail: analysis.trail,
      photoUrls,
    })

    // Return the refreshed appointment so the signature gate clears without a
    // page reload.
    const updatedAppointment = await getTechAppointmentForAccess(supabase, {
      role: access.role,
      staffId: access.staff?.id ?? null,
      appointmentId,
    })

    return NextResponse.json({
      appointment: updatedAppointment,
      check: {
        id: inserted.id,
        appointmentLineItemId: inserted.appointment_line_item_id,
        unitIndex: inserted.unit_index,
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

const VERDICT_HEADLINE: Record<string, string> = {
  go: 'SAFE TO CLEAN',
  low_moisture: 'LOW MOISTURE ONLY',
  do_not_wet_clean: 'DO NOT WET CLEAN',
}

/**
 * Telegram report for one fiber check. Fire-and-forget: a messaging failure
 * must never block a tech standing in a customer's house.
 */
async function reportCheck(check: {
  itemLabel: string
  unitIndex: number
  unitsRequired: number
  customerName: string
  appointmentDate: string
  checkedBy: string
  verdict: string
  determinedBy: string
  fiber: string | null
  confidence: string
  tagText: string
  burnResult: string | null
  summary: string
  warnings: string[]
  recommendedMethod: string | null
  trail: string[]
  photoUrls: string[]
}) {
  try {
    const piece =
      check.unitsRequired > 1
        ? `${check.itemLabel} (#${check.unitIndex} of ${check.unitsRequired})`
        : check.itemLabel

    const source =
      check.determinedBy === 'stop_list'
        ? 'care tag match (not a judgment call)'
        : check.determinedBy === 'burn_test'
          ? 'burn test'
          : check.determinedBy.replace('_', ' ')

    const lines = [
      `FIBER CHECK — ${VERDICT_HEADLINE[check.verdict] ?? check.verdict}`,
      '',
      `Item: ${piece}`,
      `Customer: ${check.customerName} (${check.appointmentDate})`,
      `Tech: ${check.checkedBy}`,
      '',
      `Fiber: ${check.fiber ?? 'unidentified'}`,
      `Confidence: ${check.confidence}`,
      `Decided by: ${source}`,
    ]
    if (check.burnResult) lines.push(`Burn test: ${check.burnResult}`)
    if (check.tagText.trim()) {
      lines.push('', `Tag read: ${check.tagText.trim().slice(0, 300)}`)
    }
    if (check.summary) lines.push('', check.summary)
    if (check.warnings.length > 0) {
      lines.push('', 'Warnings:', ...check.warnings.map((w) => `• ${w}`))
    }
    if (check.recommendedMethod) {
      lines.push('', `Method: ${check.recommendedMethod}`)
    }
    if (check.trail.length > 0) {
      lines.push('', 'HOW IT DECIDED:', ...check.trail.map((t) => `• ${t}`))
    }

    const body = lines.join('\n')

    if (check.photoUrls.length > 0) {
      // First photo carries the report; the rest follow so nothing the tech
      // shot is lost.
      await sendTelegramPhoto(check.photoUrls[0], body)
      for (const extra of check.photoUrls.slice(1)) {
        await sendTelegramPhoto(extra)
      }
      // The caption cap means a long report can be cut short on the photo.
      if (body.length > 1024) await sendTelegramNotification(body)
    } else {
      await sendTelegramNotification(body)
    }
  } catch (error) {
    console.error('[fiber-check] Telegram report failed:', error)
  }
}
