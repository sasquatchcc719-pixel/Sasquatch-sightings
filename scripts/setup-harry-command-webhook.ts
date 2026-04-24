/**
 * Set up Telegram webhook for Harry Command bot
 * Run this once to register the webhook URL with Telegram
 */

const BOT_TOKEN = process.env.HARRY_COMMAND_BOT_TOKEN
const WEBHOOK_URL =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://sightings.sasquatchcarpet.com'

if (!BOT_TOKEN) {
  console.error('❌ HARRY_COMMAND_BOT_TOKEN not set')
  process.exit(1)
}

async function setupWebhook() {
  const webhookEndpoint = `${WEBHOOK_URL}/api/telegram/harry-command`

  console.log('🔧 Setting up Harry Command bot webhook...')
  console.log('Bot token:', BOT_TOKEN.substring(0, 20) + '...')
  console.log('Webhook URL:', webhookEndpoint)
  console.log()

  // Set the webhook
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookEndpoint,
        allowed_updates: ['message', 'callback_query'],
      }),
    },
  )

  const result = (await response.json()) as {
    ok: boolean
    result?: boolean
    description?: string
  }

  if (result.ok) {
    console.log('✅ Webhook registered successfully!')
    console.log()
    console.log('Harry Command bot is now active.')
    console.log("When customers text, you'll get notifications in Telegram.")
    console.log()
    console.log('Try these commands:')
    console.log('  • "Tell Ann I\'m on my way"')
    console.log('  • "Show Sally"')
    console.log('  • "Take over Ann"')
    console.log('  • "Enable Harry for Sally"')
  } else {
    console.error('❌ Failed to set webhook:', result.description)
    process.exit(1)
  }

  // Get webhook info
  const infoResponse = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`,
  )
  const info = await infoResponse.json()
  console.log('\nWebhook info:', JSON.stringify(info, null, 2))
}

setupWebhook()
