import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { rememberRelayGroup, relayTopicReplyToSms } from '@/lib/telegram/relay'

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
type TgUser = { id: number; is_bot?: boolean }
type TgMessage = {
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

    const msg = update.message
    if (!msg) return ok

    // Any group message is a chance to learn / refresh the group id.
    if (msg.chat.type === 'supergroup') {
      await rememberRelayGroup(supabase, msg.chat)
    }

    // Only Charles's typed replies inside a customer topic become SMS.
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
      })
      if (result.sent) {
        console.log(
          `[relay] Sent topic reply → SMS to ${result.to} from ${result.from}`,
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
