/**
 * OneSignal Push Notification Helper
 * Sends push notifications to admin devices
 */

interface OneSignalNotification {
  heading: string
  content: string
  data?: Record<string, unknown>
}

export async function sendOneSignalNotification({
  heading,
  content,
  data = {},
}: OneSignalNotification): Promise<void> {
  const appId = process.env.ONESIGNAL_APP_ID
  const apiKey = process.env.ONESIGNAL_API_KEY

  if (!appId || !apiKey) {
    console.warn('OneSignal credentials not configured, skipping notification')
    return
  }

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        included_segments: ['Subscribed Users'], // Send to all subscribed admin users
        headings: { en: heading },
        contents: { en: content },
        data,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('OneSignal API error:', error)
      return
    }

    const result = await response.json()
    console.log('OneSignal notification sent:', result.id)
  } catch (error) {
    console.error('Failed to send OneSignal notification:', error)
  }
}
