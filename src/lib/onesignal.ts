/**
 * OneSignal Push Notification Helper
 * Sends push notifications to admin devices or to tagged audiences (tap, vendor, contest).
 */

const ONESIGNAL_BASE = 'https://onesignal.com/api/v1'

export type PushAudience = 'admin' | 'business_card' | 'vendor' | 'contest'

interface OneSignalNotification {
  heading: string
  content: string
  data?: Record<string, unknown>
}

/** Send to all subscribed admin users (existing behavior). */
export async function sendOneSignalNotification({
  heading,
  content,
  data = {},
}: OneSignalNotification): Promise<void> {
  await sendOneSignalToAudience('admin', heading, content, data)
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
