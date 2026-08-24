/**
 * Delivers a report card to Telegram: renders the PNG, parks it in the public
 * job-images bucket (Telegram fetches the URL itself), posts the image with a
 * short caption, then posts the full text underneath.
 *
 * Image generation is best-effort on purpose. If rendering or upload fails the
 * text report still goes out — a missing chart is an annoyance, a missing report
 * is a week of blind spots.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendTelegramNotification, sendTelegramPhoto } from '@/lib/telegram'
import {
  renderReportCardPng,
  type ReportCardInput,
} from '@/lib/reports/report-card'

/** Existing public bucket — same one job photos and fleet images already use. */
const REPORT_BUCKET = 'job-images'
const REPORT_PREFIX = 'reports'

export type ReportDelivery = {
  imageUrl: string | null
  imageSent: boolean
  textSent: boolean
}

export async function uploadReportCard(params: {
  supabase: SupabaseClient
  slug: string
  card: ReportCardInput
  /** Stable per-run key so a re-run overwrites instead of piling up files. */
  runKey: string
}): Promise<string | null> {
  const { supabase, slug, card, runKey } = params
  try {
    const png = await renderReportCardPng(card)
    const path = `${REPORT_PREFIX}/${slug}/${runKey}.png`

    const { error: uploadError } = await supabase.storage
      .from(REPORT_BUCKET)
      .upload(path, png, {
        contentType: 'image/png',
        cacheControl: '3600',
        upsert: true,
      })
    if (uploadError) {
      console.error('[reports] card upload failed:', uploadError)
      return null
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(REPORT_BUCKET).getPublicUrl(path)
    return publicUrl
  } catch (error) {
    console.error('[reports] card render failed:', error)
    return null
  }
}

export async function deliverReportCard(params: {
  supabase: SupabaseClient
  slug: string
  runKey: string
  card: ReportCardInput
  caption: string
  text: string
  /** Injectable for tests / dry runs. */
  sendPhoto?: (url: string, caption: string) => Promise<boolean>
  sendText?: (text: string) => Promise<unknown>
}): Promise<ReportDelivery> {
  const {
    supabase,
    slug,
    runKey,
    card,
    caption,
    text,
    sendPhoto = (url, cap) => sendTelegramPhoto(url, cap),
    sendText = (body: string) =>
      sendTelegramNotification(body, { disablePreview: true }),
  } = params

  const imageUrl = await uploadReportCard({ supabase, slug, card, runKey })

  let imageSent = false
  if (imageUrl) {
    imageSent = await sendPhoto(imageUrl, caption).catch((error) => {
      console.error('[reports] card send failed:', error)
      return false
    })
  }

  // When the image never made it, fold the caption into the text so the
  // headline verdict is not lost.
  const body = imageSent ? text : [caption, '', text].join('\n')
  const textSent = await sendText(body)
    .then(() => true)
    .catch((error) => {
      console.error('[reports] text send failed:', error)
      return false
    })

  return { imageUrl, imageSent, textSent }
}
