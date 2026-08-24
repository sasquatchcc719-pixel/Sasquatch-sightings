/**
 * OneSignal Push Notification Helper
 * Sends push notifications to admin devices or to tagged audiences (tap, vendor, contest).
 */

const ONESIGNAL_BASE = 'https://onesignal.com/api/v1'
const ONESIGNAL_CREATE_MESSAGE_URL = 'https://api.onesignal.com/notifications'

export type PushAudience = 'admin' | 'business_card' | 'vendor' | 'contest'

interface OneSignalNotification {
  heading: string
  content: string
  data?: Record<string, unknown>
  /** Opens this URL when the notification is tapped. */
  url?: string
  /** Public HTTPS image shown as the expanded notification picture. */
  imageUrl?: string
}

interface OneSignalExternalIdNotification extends OneSignalNotification {
  externalIds: string[]
  idempotencyKey?: string
  url?: string
}

/** Send to all subscribed admin users (existing behavior). */
export async function sendOneSignalNotification({
  heading,
  content,
  data = {},
  url,
  imageUrl,
}: OneSignalNotification): Promise<void> {
  await sendOneSignalToAudience('admin', heading, content, data, url, imageUrl)
}

/** Send a transactional push to identified users only. */
export async function sendOneSignalToExternalIds({
  externalIds,
  heading,
  content,
  data = {},
  idempotencyKey,
  url,
}: OneSignalExternalIdNotification): Promise<{ id: string } | null> {
  const appId = process.env.ONESIGNAL_APP_ID
  const apiKey = process.env.ONESIGNAL_API_KEY
  const recipients = Array.from(
    new Set(externalIds.map((id) => id.trim()).filter(Boolean)),
  )

  if (!appId || !apiKey) {
    console.warn('OneSignal credentials not configured, skipping notification')
    return null
  }
  if (recipients.length === 0) return null

  const body: Record<string, unknown> = {
    app_id: appId,
    headings: { en: heading },
    contents: { en: content },
    data,
    include_aliases: { external_id: recipients },
    target_channel: 'push',
  }
  if (idempotencyKey) body.idempotency_key = idempotencyKey
  if (url) body.url = url

  try {
    const response = await fetch(ONESIGNAL_CREATE_MESSAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.error('OneSignal API error:', await response.text())
      return null
    }

    const result = (await response.json()) as { id?: string }
    if (!result.id) {
      console.warn('OneSignal accepted the request without a notification id')
      return null
    }

    console.log('OneSignal transactional notification sent:', result.id)
    return { id: result.id }
  } catch (error) {
    console.error('Failed to send OneSignal transactional notification:', error)
    return null
  }
}

/** Build OneSignal targeting for an audience. */
function getTargetingForAudience(audience: PushAudience): {
  included_segments?: string[]
  filters?: Array<Record<string, unknown>>
} {
  switch (audience) {
    case 'admin':
      return { included_segments: ['Subscribed Users'] }
    case 'business_card':
      return {
        filters: [{ field: 'tag', key: 'source', relation: '=', value: 'tap' }],
      }
    case 'vendor':
      return {
        filters: [
          { field: 'tag', key: 'source', relation: '=', value: 'vendor' },
        ],
      }
    case 'contest':
      return {
        filters: [
          { field: 'tag', key: 'source', relation: '=', value: 'contest' },
        ],
      }
    default:
      return { included_segments: ['Subscribed Users'] }
  }
}

/**
 * Send a push to a specific audience. Returns the OneSignal notification id if created.
 */
export async function sendOneSignalToAudience(
  audience: PushAudience,
  heading: string,
  content: string,
  data: Record<string, unknown> = {},
  url?: string,
  imageUrl?: string,
): Promise<{ id: string } | null> {
  const appId = process.env.ONESIGNAL_APP_ID
  const apiKey = process.env.ONESIGNAL_API_KEY

  if (!appId || !apiKey) {
    console.warn('OneSignal credentials not configured, skipping notification')
    return null
  }

  const targeting = getTargetingForAudience(audience)

  try {
    const body: Record<string, unknown> = {
      app_id: appId,
      headings: { en: heading },
      contents: { en: content },
      data: { ...data, audience },
    }
    if (url) body.url = url
    if (imageUrl) {
      body.chrome_web_image = imageUrl
      body.big_picture = imageUrl
      body.huawei_big_picture = imageUrl
      body.ios_attachments = { report: imageUrl }
    }
    if ('included_segments' in targeting && targeting.included_segments) {
      body.included_segments = targeting.included_segments
    } else if ('filters' in targeting && targeting.filters) {
      body.filters = targeting.filters
    }

    const response = await fetch(`${ONESIGNAL_BASE}/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('OneSignal API error:', error)
      return null
    }

    const result = (await response.json()) as { id?: string }
    if (result.id) {
      console.log(
        'OneSignal notification sent:',
        result.id,
        'audience:',
        audience,
      )
      return { id: result.id }
    }
    return null
  } catch (error) {
    console.error('Failed to send OneSignal notification:', error)
    return null
  }
}

/**
 * Schedule a push notification 30 minutes before a job starts.
 * Uses OneSignal's `send_after` for fire-and-forget scheduled delivery.
 */
export async function scheduleJobReminder(params: {
  appointmentId: string
  appointmentDate: string
  startTime: string
  customerName: string
  address: string
}): Promise<{ id: string } | null> {
  const appId = process.env.ONESIGNAL_APP_ID
  const apiKey = process.env.ONESIGNAL_API_KEY
  if (!appId || !apiKey) return null

  const { appointmentDate, startTime, customerName, address, appointmentId } =
    params

  const [hours, minutes] = startTime.split(':').map(Number)
  const jobTime = new Date(
    `${appointmentDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`,
  )
  const reminderTime = new Date(jobTime.getTime() - 30 * 60 * 1000)

  if (reminderTime <= new Date()) return null

  const sendAfter = reminderTime.toISOString()
  const timeLabel = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`

  try {
    const response = await fetch(`${ONESIGNAL_BASE}/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        included_segments: ['Subscribed Users'],
        headings: { en: 'Job in 30 min' },
        contents: { en: `${customerName} at ${address} · ${timeLabel}` },
        send_after: sendAfter,
        data: {
          type: 'job_reminder',
          appointment_id: appointmentId,
          url: `/admin/operations/appointments/${appointmentId}`,
        },
      }),
    })

    if (!response.ok) {
      console.error(
        '[scheduleJobReminder] OneSignal error:',
        await response.text(),
      )
      return null
    }

    const result = (await response.json()) as { id?: string }
    if (result.id) {
      console.log(
        '[scheduleJobReminder] Scheduled:',
        result.id,
        'for',
        sendAfter,
      )
      return { id: result.id }
    }
    return null
  } catch (error) {
    console.error('[scheduleJobReminder] Error:', error)
    return null
  }
}

export interface OneSignalMessageStats {
  successful: number
  received: number
  converted: number
  failed: number
  errored: number
}

/**
 * Fetch delivery stats for a notification from OneSignal View notification API.
 */
export async function getOneSignalMessageStats(
  messageId: string,
): Promise<OneSignalMessageStats | null> {
  const appId = process.env.ONESIGNAL_APP_ID
  const apiKey = process.env.ONESIGNAL_API_KEY

  if (!appId || !apiKey) return null

  try {
    const url = `${ONESIGNAL_BASE}/notifications/${messageId}?app_id=${appId}`
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${apiKey}` },
    })

    if (!response.ok) return null

    const data = (await response.json()) as {
      successful?: number
      received?: number
      converted?: number
      failed?: number
      errored?: number
    }
    return {
      successful: data.successful ?? 0,
      received: data.received ?? 0,
      converted: data.converted ?? 0,
      failed: data.failed ?? 0,
      errored: data.errored ?? 0,
    }
  } catch {
    return null
  }
}
