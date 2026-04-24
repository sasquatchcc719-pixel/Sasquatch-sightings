/**
 * Harry Command Bot - Telegram interface for Charles to manage conversations
 * Sends real-time customer message notifications and accepts commands
 */

const BOT_TOKEN = process.env.HARRY_COMMAND_BOT_TOKEN
const CHARLES_CHAT_ID = process.env.CHARLES_TELEGRAM_CHAT_ID

type TelegramMessage = {
  text: string
  parse_mode?: 'Markdown' | 'HTML'
  disable_web_page_preview?: boolean
  reply_markup?: {
    inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>
  }
}

/**
 * Send a message to Charles via Harry Command bot
 */
export async function sendToCharles(
  message: string,
  options?: {
    parseMode?: 'Markdown' | 'HTML'
    disablePreview?: boolean
    buttons?: Array<Array<{ text: string; data: string }>>
  },
): Promise<boolean> {
  if (!BOT_TOKEN || !CHARLES_CHAT_ID) {
    console.warn('Harry Command bot not configured')
    return false
  }

  try {
    const body: TelegramMessage = {
      text: message,
    }

    if (options?.parseMode) {
      body.parse_mode = options.parseMode
    }

    if (options?.disablePreview) {
      body.disable_web_page_preview = true
    }

    if (options?.buttons) {
      body.reply_markup = {
        inline_keyboard: options.buttons.map((row) =>
          row.map((btn) => ({
            text: btn.text,
            callback_data: btn.data,
          })),
        ),
      }
    }

    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHARLES_CHAT_ID,
          ...body,
        }),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      console.error('Harry Command bot error:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Failed to send to Harry Command bot:', error)
    return false
  }
}

/**
 * Notify Charles of a new customer message
 */
export async function notifyNewCustomerMessage(params: {
  customerName?: string
  phone: string
  message: string
  source: 'main' | 'lsa' | 'nextdoor' | 'other'
  conversationId: string
  harryResponse?: string
}): Promise<void> {
  const {
    customerName,
    phone,
    message: customerMessage,
    source,
    conversationId,
    harryResponse,
  } = params

  const sourceLabel =
    source === 'main'
      ? '📞 MAIN LINE'
      : source === 'lsa'
        ? '🔵 GOOGLE LSA'
        : source === 'nextdoor'
          ? '🏘️ NEXTDOOR'
          : '💬 OTHER'

  const name = customerName || phone
  const msgPreview =
    customerMessage.length > 100
      ? customerMessage.substring(0, 100) + '...'
      : customerMessage

  let notification = `${sourceLabel}\n\n👤 *${name}*\n📱 ${phone}\n\n💬 "${msgPreview}"`

  if (harryResponse) {
    const harryPreview =
      harryResponse.length > 100
        ? harryResponse.substring(0, 100) + '...'
        : harryResponse
    notification += `\n\n🤖 Harry: "${harryPreview}"`
  }

  const buttons = [
    [
      { text: '📋 View Full Thread', data: `view_${conversationId}` },
      { text: '✉️ Reply', data: `reply_${conversationId}` },
    ],
  ]

  await sendToCharles(notification, {
    parseMode: 'Markdown',
    buttons,
  })
}

/**
 * Notify Charles that Harry needs help with a conversation
 */
export async function notifyHarryNeedsHelp(params: {
  customerName?: string
  phone: string
  reason: string
  conversationId: string
}): Promise<void> {
  const { customerName, phone, reason, conversationId } = params

  const name = customerName || phone

  const notification = `⚠️ *HARRY NEEDS HELP*\n\n👤 ${name}\n📱 ${phone}\n\n${reason}`

  const buttons = [
    [
      { text: '👀 View Conversation', data: `view_${conversationId}` },
      { text: '🎯 Take Over', data: `takeover_${conversationId}` },
    ],
  ]

  await sendToCharles(notification, {
    parseMode: 'Markdown',
    buttons,
  })
}

/**
 * Confirm an action was completed
 */
export async function confirmAction(message: string): Promise<void> {
  await sendToCharles(`✅ ${message}`)
}

/**
 * Send an error message
 */
export async function sendError(message: string): Promise<void> {
  await sendToCharles(`❌ ${message}`)
}
