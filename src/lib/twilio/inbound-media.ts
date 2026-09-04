import { randomUUID } from 'crypto'
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'

export const CUSTOMER_MEDIA_BUCKET = 'customer-media'
const MAX_MEDIA_COUNT = 10
const MAX_MEDIA_BYTES = 15 * 1024 * 1024

export type TwilioInboundMedia = {
  index: number
  url: string
  contentType: string
  mediaSid: string | null
}

export type StoredInboundMedia = {
  id: string
  contentType: string
  status: 'pending' | 'available' | 'failed'
  category:
    | 'unclassified'
    | 'customer_file'
    | 'estimate'
    | 'job'
    | 'preexisting_damage'
    | 'service_concern'
  signedUrl: string | null
  customerId: string | null
  appointmentId: string | null
  jobPhotoId: string | null
  errorMessage: string | null
}

export type CustomerMediaAction =
  | 'customer_file'
  | 'estimate'
  | 'job'
  | 'preexisting_damage'

export type CustomerMediaActionResult = {
  ok: boolean
  message: string
  category?: CustomerMediaAction
  appointmentId?: string
  invoiceId?: string | null
}

type CustomerMediaRow = {
  id: string
  customer_id: string | null
  appointment_id: string | null
  job_photo_id: string | null
  storage_path: string | null
  content_type: string
  status: 'pending' | 'available' | 'failed'
  category: StoredInboundMedia['category']
  error_message: string | null
}

function mediaSidFromUrl(url: string): string | null {
  try {
    const part = new URL(url).pathname.split('/').filter(Boolean).at(-1)
    return part?.startsWith('ME') ? part : null
  } catch {
    return null
  }
}

export function parseTwilioInboundMedia(
  formData: Pick<FormData, 'get'>,
): TwilioInboundMedia[] {
  const rawCount = Number.parseInt(String(formData.get('NumMedia') || '0'), 10)
  const count = Number.isFinite(rawCount)
    ? Math.max(0, Math.min(rawCount, MAX_MEDIA_COUNT))
    : 0
  const media: TwilioInboundMedia[] = []

  for (let index = 0; index < count; index += 1) {
    const url = String(formData.get(`MediaUrl${index}`) || '').trim()
    if (!url) continue
    const contentType =
      String(formData.get(`MediaContentType${index}`) || '')
        .trim()
        .toLowerCase() || 'application/octet-stream'
    media.push({
      index,
      url,
      contentType,
      mediaSid: mediaSidFromUrl(url),
    })
  }

  return media
}

export function inboundMessageContent(
  body: string,
  media: TwilioInboundMedia[],
): string {
  const trimmed = body.trim()
  if (trimmed) return trimmed
  if (media.length === 0) return ''
  const photos = media.filter((item) => item.contentType.startsWith('image/'))
  if (photos.length === media.length) {
    return photos.length === 1
      ? '📷 Customer sent a photo'
      : `📷 Customer sent ${photos.length} photos`
  }
  return media.length === 1
    ? '📎 Customer sent an attachment'
    : `📎 Customer sent ${media.length} attachments`
}

function extensionForContentType(contentType: string): string {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/tiff': 'tiff',
    'image/bmp': 'bmp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'application/pdf': 'pdf',
  }
  return extensions[contentType] || 'bin'
}

function basicAuthHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`
}

async function signedUrlForPath(
  supabase: SupabaseClient,
  storagePath: string | null,
): Promise<string | null> {
  if (!storagePath) return null
  const { data, error } = await supabase.storage
    .from(CUSTOMER_MEDIA_BUCKET)
    .createSignedUrl(storagePath, 60 * 60)
  if (error) {
    console.error('[MMS] Failed to sign stored media:', error.message)
    return null
  }
  return data.signedUrl
}

async function toStoredMedia(
  supabase: SupabaseClient,
  row: CustomerMediaRow,
): Promise<StoredInboundMedia> {
  return {
    id: row.id,
    contentType: row.content_type,
    status: row.status,
    category: row.category,
    signedUrl:
      row.status === 'available'
        ? await signedUrlForPath(supabase, row.storage_path)
        : null,
    customerId: row.customer_id,
    appointmentId: row.appointment_id,
    jobPhotoId: row.job_photo_id,
    errorMessage: row.error_message,
  }
}

async function persistOneInboundMedia(params: {
  supabase: SupabaseClient
  conversationId: string
  customerId: string | null
  senderPhone: string
  businessNumber: string | null
  twilioMessageSid: string
  media: TwilioInboundMedia
  accountSid: string
  authToken: string
  fetchImpl: typeof fetch
}): Promise<StoredInboundMedia> {
  const {
    supabase,
    conversationId,
    customerId,
    senderPhone,
    businessNumber,
    twilioMessageSid,
    media,
    accountSid,
    authToken,
    fetchImpl,
  } = params

  const { data: existing, error: existingError } = await supabase
    .from('ops_customer_media')
    .select(
      'id, customer_id, appointment_id, job_photo_id, storage_path, content_type, status, category, error_message',
    )
    .eq('twilio_message_sid', twilioMessageSid)
    .eq('media_index', media.index)
    .maybeSingle()
  if (existingError) throw existingError

  let row = existing as CustomerMediaRow | null
  if (!row) {
    const { data: inserted, error: insertError } = await supabase
      .from('ops_customer_media')
      .insert({
        conversation_id: conversationId,
        customer_id: customerId,
        sender_phone: senderPhone,
        business_number: businessNumber,
        twilio_message_sid: twilioMessageSid,
        twilio_media_sid: media.mediaSid,
        media_index: media.index,
        source_url: media.url,
        content_type: media.contentType,
        status: 'pending',
      })
      .select(
        'id, customer_id, appointment_id, job_photo_id, storage_path, content_type, status, category, error_message',
      )
      .single()
    if (insertError) throw insertError
    row = inserted as CustomerMediaRow
  } else if (!row.customer_id && customerId) {
    const { data: linked, error: linkError } = await supabase
      .from('ops_customer_media')
      .update({ customer_id: customerId })
      .eq('id', row.id)
      .select(
        'id, customer_id, appointment_id, job_photo_id, storage_path, content_type, status, category, error_message',
      )
      .single()
    if (linkError) throw linkError
    row = linked as CustomerMediaRow
  }

  if (row.status === 'available' && row.storage_path) {
    return toStoredMedia(supabase, row)
  }

  try {
    const response = await fetchImpl(media.url, {
      headers: { Authorization: basicAuthHeader(accountSid, authToken) },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      throw new Error(`Twilio media download returned ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) throw new Error('Twilio media download was empty')
    if (buffer.length > MAX_MEDIA_BYTES) {
      throw new Error('Twilio media exceeded the 15 MB storage limit')
    }

    const responseType = response.headers
      .get('content-type')
      ?.split(';')[0]
      ?.trim()
      .toLowerCase()
    const contentType =
      responseType && responseType !== 'application/octet-stream'
        ? responseType
        : media.contentType
    const extension = extensionForContentType(contentType)
    const safePhone = senderPhone.replace(/\D/g, '') || 'unknown'
    const storagePath = `inbound/${safePhone}/${twilioMessageSid}/${media.index}-${randomUUID()}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from(CUSTOMER_MEDIA_BUCKET)
      .upload(storagePath, buffer, {
        contentType,
        upsert: false,
      })
    if (uploadError) throw uploadError

    const { data: updated, error: updateError } = await supabase
      .from('ops_customer_media')
      .update({
        storage_path: storagePath,
        content_type: contentType,
        byte_size: buffer.length,
        status: 'available',
        error_message: null,
      })
      .eq('id', row.id)
      .select(
        'id, customer_id, appointment_id, job_photo_id, storage_path, content_type, status, category, error_message',
      )
      .single()
    if (updateError) {
      await supabase.storage.from(CUSTOMER_MEDIA_BUCKET).remove([storagePath])
      throw updateError
    }
    return toStoredMedia(supabase, updated as CustomerMediaRow)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Media ingest failed'
    console.error(`[MMS] ${twilioMessageSid}/${media.index}:`, message)
    const { data: failed } = await supabase
      .from('ops_customer_media')
      .update({ status: 'failed', error_message: message.slice(0, 500) })
      .eq('id', row.id)
      .select(
        'id, customer_id, appointment_id, job_photo_id, storage_path, content_type, status, category, error_message',
      )
      .single()
    return toStoredMedia(supabase, (failed || row) as CustomerMediaRow)
  }
}

export async function persistInboundMedia(params: {
  supabase: SupabaseClient
  conversationId: string
  customerId: string | null
  senderPhone: string
  businessNumber: string | null
  twilioMessageSid: string
  media: TwilioInboundMedia[]
  accountSid?: string
  authToken?: string
  fetchImpl?: typeof fetch
}): Promise<StoredInboundMedia[]> {
  const {
    supabase,
    conversationId,
    customerId,
    senderPhone,
    businessNumber,
    twilioMessageSid,
    media,
    accountSid = process.env.TWILIO_ACCOUNT_SID,
    authToken = process.env.TWILIO_AUTH_TOKEN,
    fetchImpl = fetch,
  } = params
  if (media.length === 0) return []
  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials are required to download inbound media')
  }

  return Promise.all(
    media.map((item) =>
      persistOneInboundMedia({
        supabase,
        conversationId,
        customerId,
        senderPhone,
        businessNumber,
        twilioMessageSid,
        media: item,
        accountSid,
        authToken,
        fetchImpl,
      }),
    ),
  )
}

function mountainDateIso(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Denver',
  })
}

export async function classifyCustomerMedia(
  supabase: SupabaseClient,
  mediaId: string,
  action: CustomerMediaAction,
): Promise<CustomerMediaActionResult> {
  const { data: media, error } = await supabase
    .from('ops_customer_media')
    .select(
      'id, customer_id, appointment_id, job_photo_id, storage_path, content_type, status, category, error_message',
    )
    .eq('id', mediaId)
    .maybeSingle()
  if (error) throw error
  if (!media) return { ok: false, message: 'Photo was not found.' }

  if (action === 'customer_file' || action === 'estimate') {
    const { error: updateError } = await supabase
      .from('ops_customer_media')
      .update({ category: action, classified_at: new Date().toISOString() })
      .eq('id', mediaId)
    if (updateError) throw updateError
    return {
      ok: true,
      category: action,
      message:
        action === 'estimate'
          ? 'Saved as an estimate/preliminary photo.'
          : media.customer_id
            ? 'Saved to the customer file.'
            : 'Saved with this conversation until the customer is identified.',
    }
  }

  if (!media.customer_id) {
    return {
      ok: false,
      message:
        'Identify or create the customer before attaching this to a job.',
    }
  }
  if (media.status !== 'available' || !media.storage_path) {
    return { ok: false, message: 'The photo is not available for attachment.' }
  }
  if (!String(media.content_type).startsWith('image/')) {
    return { ok: false, message: 'Only images can be attached as job photos.' }
  }

  if (media.job_photo_id && media.appointment_id) {
    return {
      ok: true,
      category: action,
      appointmentId: media.appointment_id,
      message: 'This photo is already attached to the job and invoice.',
    }
  }

  const { data: appointment, error: appointmentError } = await supabase
    .from('ops_appointments')
    .select('id, appointment_date')
    .eq('customer_id', media.customer_id)
    .in('status', ['booked', 'confirmed', 'on_my_way', 'in_progress'])
    .gte('appointment_date', mountainDateIso())
    .order('appointment_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (appointmentError) throw appointmentError
  if (!appointment) {
    return {
      ok: false,
      message: 'No upcoming job was found for this customer.',
    }
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from(CUSTOMER_MEDIA_BUCKET)
    .download(media.storage_path)
  if (downloadError || !file) {
    throw downloadError || new Error('Stored customer photo could not be read')
  }

  const jobBuffer = await sharp(Buffer.from(await file.arrayBuffer()))
    .rotate()
    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  const storagePath = `job-photos/${appointment.id}/customer-sms-${Date.now()}-${mediaId}.jpg`
  const { error: uploadError } = await supabase.storage
    .from('job-images')
    .upload(storagePath, jobBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    })
  if (uploadError) throw uploadError

  const {
    data: { publicUrl },
  } = supabase.storage.from('job-images').getPublicUrl(storagePath)
  const { data: jobPhoto, error: insertError } = await supabase
    .from('ops_job_photos')
    .insert({
      appointment_id: appointment.id,
      storage_path: storagePath,
      public_url: publicUrl,
      label: action === 'preexisting_damage' ? 'before' : 'general',
      watermarked: false,
      source: 'customer',
      uploaded_by_label: 'Customer via text',
      original_filename: `text-message-${mediaId}.jpg`,
    })
    .select('id')
    .single()
  if (insertError) {
    await supabase.storage.from('job-images').remove([storagePath])
    throw insertError
  }

  const { data: invoice } = await supabase
    .from('ops_invoices')
    .select('id')
    .eq('appointment_id', appointment.id)
    .maybeSingle()

  const { error: mediaUpdateError } = await supabase
    .from('ops_customer_media')
    .update({
      appointment_id: appointment.id,
      job_photo_id: jobPhoto.id,
      category: action,
      classified_at: new Date().toISOString(),
    })
    .eq('id', mediaId)
  if (mediaUpdateError) {
    await supabase.from('ops_job_photos').delete().eq('id', jobPhoto.id)
    await supabase.storage.from('job-images').remove([storagePath])
    throw mediaUpdateError
  }

  return {
    ok: true,
    category: action,
    appointmentId: appointment.id,
    invoiceId: invoice?.id || null,
    message:
      action === 'preexisting_damage'
        ? `Saved as pre-existing damage for the ${appointment.appointment_date} job.`
        : `Attached to the ${appointment.appointment_date} job${invoice ? ' and invoice' : ''}.`,
  }
}
