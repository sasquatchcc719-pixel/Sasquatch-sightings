import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  handleCustomerMediaCallback,
  postToTopic,
  registerRelayOperator,
  rememberRelayGroup,
  relayTopicReplyToSms,
} from '@/lib/telegram/relay'

export const maxDuration = 30

/**
 * Webhook for Sasquatchnotificationsbot — the SMS relay.
 *
 * Two jobs, no LLM:
 *  1. Discover the two group chat ids (auto-recorded the first time the bot
 *     sees a message / is added to "LSA Leads" and "Customers").
 *  2. A reply Charles types inside a customer's topic → send it to that
 *     customer as an SMS from the same business number they texted.
 *
 * Always returns 200 so Telegram never redelivers (which would double-send an
 * SMS). All real failures are logged and surfaced into the topic instead.
 */

type TgChat = { id: number; title?: string; type?: string }
type TgUser = {
  id: number
  is_bot?: boolean
  first_name?: string
  username?: string
}
type TgMessage = {
  message_id?: number
  from?: TgUser
  chat: TgChat
  text?: string
  message_thread_id?: number
  is_topic_message?: boolean
  // Service-message markers we must ignore (topic created/closed, etc.)
  forum_topic_created?: unknown
  forum_topic_edited?: unknown
  forum_topic_closed?: unknown
  forum_topic_reopened?: unknown
}
type TelegramUpdate = {
  update_id?: number
  message?: TgMessage
  my_chat_member?: { chat: TgChat }
  callback_query?: {
    id: string
    from: TgUser
    data?: string
    message?: TgMessage
  }
}

function verifySecret(request: NextRequest): boolean {
  const expected = process.env.TELEGRAM_RELAY_SECRET_TOKEN
  if (!expected) return true // not configured → allow (dev)
  return request.headers.get('x-telegram-bot-api-secret-token') === expected
}

function isServiceMessage(msg: TgMessage): boolean {
  return Boolean(
    msg.forum_topic_created ||
    msg.forum_topic_edited ||
    msg.forum_topic_closed ||
    msg.forum_topic_reopened,
  )
}

export async function POST(request: NextRequest) {
  // Acknowledge no matter what — a non-200 makes Telegram resend the update.
  const ok = NextResponse.json({ ok: true })

  try {
    if (!verifySecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const update = (await request.json()) as TelegramUpdate
    const supabase = createAdminClient()

    // Bot added to a group (or promoted) → record the group id for discovery.
    if (update.my_chat_member?.chat?.type === 'supergroup') {
      await rememberRelayGroup(supabase, update.my_chat_member.chat)
      return ok
    }

    const callback = update.callback_query
    const callbackMessage = callback?.message
    if (
      callback?.data &&
      callbackMessage?.chat.type === 'supergroup' &&
      typeof callbackMessage.message_id === 'number'
    ) {
      await rememberRelayGroup(supabase, callbackMessage.chat)
      const handled = await handleCustomerMediaCallback({
        supabase,
        callbackQueryId: callback.id,
        data: callback.data,
        chatId: callbackMessage.chat.id,
        messageId: callbackMessage.message_id,
        topicId: callbackMessage.message_thread_id,
      })
      if (handled) return ok
    }

    const msg = update.message
    if (!msg) return ok

    // Any group message is a chance to learn / refresh the group id.
    if (msg.chat.type === 'supergroup') {
      await rememberRelayGroup(supabase, msg.chat)
    }

    // `/whoami` — self-onboarding for a new operator. Registers the sender so
    // their replies get labeled with their name, and confirms their Telegram id.
    // Handled before the command filter below (which ignores "/" messages).
    if (
      msg.chat.type === 'supergroup' &&
      typeof msg.text === 'string' &&
      msg.text.trim().toLowerCase().startsWith('/whoami') &&
      msg.from &&
      !msg.from.is_bot
    ) {
      const reply = await registerRelayOperator({
        supabase,
        telegramUserId: msg.from.id,
        fallbackName: msg.from.first_name ?? null,
      })
      await postToTopic(msg.chat.id, msg.message_thread_id, reply)
      return ok
    }

    // Any relay operator's typed reply inside a customer topic becomes SMS.
    // (Attribution — who sent it — is resolved from relay_operators downstream.)
    if (
      msg.chat.type === 'supergroup' &&
      typeof msg.message_thread_id === 'number' &&
      typeof msg.text === 'string' &&
      msg.text.trim().length > 0 &&
      !msg.text.startsWith('/') && // ignore bot commands
      !msg.from?.is_bot && // ignore the bot's own posts (cards, inbound)
      !isServiceMessage(msg)
    ) {
      const result = await relayTopicReplyToSms({
        supabase,
        groupChatId: msg.chat.id,
        topicId: msg.message_thread_id,
        text: msg.text,
        operatorTelegramId: msg.from?.id ?? null,
        operatorFallbackName: msg.from?.first_name ?? null,
      })
      if (result.sent) {
        console.log(
          `[relay] Sent topic reply → SMS to ${result.to} from ${result.from} by ${result.operator}`,
        )
      } else if (result.reason !== 'unmapped-topic') {
        console.warn(`[relay] Topic reply not sent: ${result.reason}`)
      }
    }

    return ok
  } catch (error) {
    console.error('[relay] webhook error:', error)
    return ok
  }
}

// Convenience health check (Telegram only ever POSTs).
export async function GET() {
  return NextResponse.json({ ok: true, relay: 'telegram-sms' })
}
