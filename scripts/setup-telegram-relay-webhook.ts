const botToken = process.env.TELEGRAM_BOT_TOKEN
const secretToken = process.env.TELEGRAM_RELAY_SECRET_TOKEN
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://sightings.sasquatchcarpet.com'

if (!botToken || !secretToken) {
  throw new Error(
    'TELEGRAM_BOT_TOKEN and TELEGRAM_RELAY_SECRET_TOKEN are required.',
  )
}

const webhookUrl = `${siteUrl.replace(/\/$/, '')}/api/telegram/relay`
const allowedUpdates = ['message', 'callback_query', 'my_chat_member']

async function configureRelayWebhook() {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: allowedUpdates,
      }),
    },
  )
  const result = (await response.json()) as {
    ok: boolean
    description?: string
  }
  if (!response.ok || !result.ok) {
    throw new Error(result.description || 'Telegram setWebhook failed.')
  }

  const infoResponse = await fetch(
    `https://api.telegram.org/bot${botToken}/getWebhookInfo`,
  )
  const info = (await infoResponse.json()) as {
    ok: boolean
    result?: {
      url?: string
      allowed_updates?: string[]
      pending_update_count?: number
      last_error_message?: string
    }
  }
  if (!infoResponse.ok || !info.ok || !info.result) {
    throw new Error('Telegram getWebhookInfo failed after configuration.')
  }

  const missing = allowedUpdates.filter(
    (update) => !info.result?.allowed_updates?.includes(update),
  )
  if (info.result.url !== webhookUrl || missing.length > 0) {
    throw new Error(
      `Telegram webhook verification failed. Missing updates: ${missing.join(', ') || 'none'}.`,
    )
  }

  console.log(
    JSON.stringify(
      {
        url: info.result.url,
        allowedUpdates: info.result.allowed_updates,
        pendingUpdates: info.result.pending_update_count || 0,
        lastError: info.result.last_error_message || null,
      },
      null,
      2,
    ),
  )
}

void configureRelayWebhook()
