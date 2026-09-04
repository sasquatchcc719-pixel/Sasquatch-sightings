/**
 * Telegram SMS relay — the no-LLM replacement for Harry's inbound handling.
 *
 * Inbound customer SMS  →  a Telegram forum TOPIC (one thread per customer
 *                          phone) in the right group, with a contact card.
 * Charles replies in the topic  →  the reply is sent back to the customer as
 *                          an SMS FROM THE SAME business number they texted.
 *
 * No model decides anything. This is a dumb pipe. Both directions fail soft:
 * a relay error never breaks SMS handling or the webhook response.
 *
 * Runs on Sasquatchnotificationsbot (TELEGRAM_BOT_TOKEN), which is an admin in
 * both groups ("LSA Leads" and "Customers", Topics ON).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getInboundSmsCustomerContext,
  type InboundSmsCustomerContext,
} from '@/lib/twilio/inbound-sms-customer-context'
import { sendCustomerSMSWithResult } from '@/lib/twilio'
import {
  classifyCustomerMedia,
  type StoredInboundMedia,
} from '@/lib/twilio/inbound-media'
import {
  openServiceConcern,
  openServiceConcernFromPhone,
} from '@/lib/ops/service-concerns'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ADMIN_BASE_URL = 'https://sightings.sasquatchcarpet.com'

export type RelayRole = 'lsa' | 'customers'

export type RelayThread = {
  id: string
  phone: string
  group_chat_id: number
  topic_id: number
  business_number: string | null
  customer_name: string | null
  is_lsa: boolean
}

// ── Telegram Bot API ────────────────────────────────────────────────────────

/**
 * Call a Telegram Bot API method. Returns the `result` payload, or null on any
 * failure (logged). Never throws — callers treat null as "relay unavailable"
 * and fall through to normal handling.
 */
async function callTelegram<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  if (!BOT_TOKEN) {
    console.warn(`[relay] TELEGRAM_BOT_TOKEN not set — skipping ${method}`)
    return null
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    const json = (await res.json()) as {
      ok: boolean
      result?: T
      description?: string
    }
    if (!json.ok) {
      console.error(`[relay] Telegram ${method} failed: ${json.description}`)
      return null
    }
    return (json.result ?? null) as T | null
  } catch (error) {
    console.error(`[relay] Telegram ${method} threw:`, error)
    return null
  }
}

async function createForumTopic(
  chatId: number,
  name: string,
): Promise<number | null> {
  const result = await callTelegram<{ message_thread_id: number }>(
    'createForumTopic',
    { chat_id: chatId, name: name.slice(0, 128) },
  )
  return result?.message_thread_id ?? null
}

/**
 * Post a plain-text message into a forum topic. Returns success.
 * `topicId` may be omitted to post in the group's General area (e.g. a reply to
 * /whoami typed outside any customer topic).
 */
export async function postToTopic(
  chatId: number,
  topicId: number | null | undefined,
  text: string,
): Promise<boolean> {
  const result = await callTelegram('sendMessage', {
    chat_id: chatId,
    ...(typeof topicId === 'number' ? { message_thread_id: topicId } : {}),
    text,
    disable_web_page_preview: true,
  })
  return result !== null
}

function mediaReplyMarkup(media: StoredInboundMedia) {
  const id = media.id
  const rows: Array<
    Array<{ text: string; callback_data?: string; url?: string }>
  > = [
    [
      { text: 'Customer file', callback_data: `media:customer_file:${id}` },
      { text: 'Estimate', callback_data: `media:estimate:${id}` },
    ],
  ]

  if (media.customerId && media.contentType.startsWith('image/')) {
    rows.push([
      {
        text: 'Service concern',
        callback_data: `concern:media:${id}`,
      },
      { text: 'Job & invoice', callback_data: `media:job:${id}` },
    ])
    rows.push([
      {
        text: 'Pre-existing damage',
        callback_data: `media:preexisting_damage:${id}`,
      },
    ])
  }

  rows.push([
    {
      text: media.customerId ? 'Open customer records' : 'Identify customer',
      url: `${ADMIN_BASE_URL}/admin/operations/customers`,
    },
  ])
  return { inline_keyboard: rows }
}

function textConcernReplyMarkup(threadId: string) {
  return {
    inline_keyboard: [
      [
        {
          text: 'Start service concern',
          callback_data: `concern:thread:${threadId}`,
        },
        {
          text: 'Open concern queue',
          url: `${ADMIN_BASE_URL}/admin/operations/service-concerns`,
        },
      ],
    ],
  }
}

async function postInboundTextToTopic(params: {
  chatId: number
  topicId: number
  text: string
  concernThreadId?: string | null
}): Promise<boolean> {
  const result = await callTelegram('sendMessage', {
    chat_id: params.chatId,
    message_thread_id: params.topicId,
    text: params.text,
    disable_web_page_preview: true,
    ...(params.concernThreadId
      ? { reply_markup: textConcernReplyMarkup(params.concernThreadId) }
      : {}),
  })
  return result !== null
}

async function postInboundMediaToTopic(params: {
  chatId: number
  topicId: number
  media: StoredInboundMedia
  caption?: string
}): Promise<boolean> {
  const { chatId, topicId, media, caption } = params
  if (!media.signedUrl || media.status !== 'available') return false

  const isImage = media.contentType.startsWith('image/')
  const result = await callTelegram(isImage ? 'sendPhoto' : 'sendDocument', {
    chat_id: chatId,
    message_thread_id: topicId,
    [isImage ? 'photo' : 'document']: media.signedUrl,
    ...(caption ? { caption: caption.slice(0, 1024) } : {}),
    reply_markup: mediaReplyMarkup(media),
  })
  return result !== null
}

// ── Group discovery & lookup ────────────────────────────────────────────────

/**
 * Decide which relay group a Telegram supergroup is, from its title. Keyword
 * match keeps it self-healing if Charles tweaks the names. Returns null for
 * groups we don't manage.
 */
export function classifyGroupRole(title: string | undefined): RelayRole | null {
  if (!title) return null
  const t = title.toLowerCase()
  if (t.includes('lsa')) return 'lsa'
  if (t.includes('customer')) return 'customers'
  return null
}

/**
 * Record a group's chat id the first time we see a message in it. Called from
 * the webhook for every supergroup update, so the two group ids populate
 * themselves without any manual config.
 */
export async function rememberRelayGroup(
  supabase: SupabaseClient,
  chat: { id: number; title?: string; type?: string },
): Promise<void> {
  const role = classifyGroupRole(chat.title)
  if (!role) return
  const { error } = await supabase.from('telegram_relay_groups').upsert(
    {
      role,
      chat_id: chat.id,
      title: chat.title ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'role' },
  )
  if (error) {
    console.error(`[relay] Failed to remember group ${role}:`, error.message)
  } else {
    console.log(`[relay] Group "${chat.title}" → role=${role} id=${chat.id}`)
  }
}

async function getRelayGroupChatId(
  supabase: SupabaseClient,
  role: RelayRole,
): Promise<number | null> {
  const { data } = await supabase
    .from('telegram_relay_groups')
    .select('chat_id')
    .eq('role', role)
    .maybeSingle()
  return data ? Number(data.chat_id) : null
}

// ── Thread (topic) mapping ──────────────────────────────────────────────────

const THREAD_FIELDS =
  'id, phone, group_chat_id, topic_id, business_number, customer_name, is_lsa'

async function findThreadByPhone(
  supabase: SupabaseClient,
  phone: string,
): Promise<RelayThread | null> {
  const { data } = await supabase
    .from('telegram_relay_threads')
    .select(THREAD_FIELDS)
    .eq('phone', phone)
    .maybeSingle()
  return (data as RelayThread | null) ?? null
}

export async function findThreadByTopic(
  supabase: SupabaseClient,
  groupChatId: number,
  topicId: number,
): Promise<RelayThread | null> {
  const { data } = await supabase
    .from('telegram_relay_threads')
    .select(THREAD_FIELDS)
    .eq('group_chat_id', groupChatId)
    .eq('topic_id', topicId)
    .maybeSingle()
  return (data as RelayThread | null) ?? null
}

// ── Contact card ────────────────────────────────────────────────────────────

function formatUsPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-10)
  if (d.length !== 10) return phone
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

function formatJobDate(date: string, startTime: string | null): string {
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
  if (!startTime) return label
  const [hour, minute] = startTime.split(':').map(Number)
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 0, 1, hour, minute)))
  return `${label} at ${time}`
}

/**
 * Plain-text contact card pinned as the first message of a customer's topic.
 * Plain text (no parse_mode) on purpose — no escaping bugs can ever drop the
 * message, and Telegram auto-links the bare admin URL.
 */
export function renderContactCardText(
  phone: string,
  context: InboundSmsCustomerContext | null,
): string {
  const lines: string[] = []

  if (!context) {
    lines.push(`📇 ${formatUsPhone(phone)}`)
    lines.push('No customer record matched this number — likely a new lead.')
    lines.push('')
    lines.push(`Admin: ${ADMIN_BASE_URL}/admin/conversations?source=inbound`)
    return lines.join('\n')
  }

  const c = context.customer
  lines.push(`📇 ${c.name}`)
  if (c.businessName) lines.push(`🏢 ${c.businessName}`)
  lines.push(`📞 ${formatUsPhone(phone)}`)
  if (c.email) lines.push(`✉️ ${c.email}`)
  if (context.address) lines.push(`🏠 ${context.address}`)

  if (context.jobs.length) {
    lines.push('')
    lines.push('🧾 Job history:')
    for (const job of context.jobs) {
      const bits = [
        job.timing === 'upcoming' ? 'Upcoming' : 'Recent',
        formatJobDate(job.date, job.startTime),
        job.status.replaceAll('_', ' '),
        job.services.length ? job.services.join(', ') : null,
        job.quotedTotal != null ? `$${job.quotedTotal.toFixed(2)}` : null,
      ].filter(Boolean)
      lines.push(`• ${bits.join(' · ')}`)
      lines.push(`  ${ADMIN_BASE_URL}/admin/operations/appointments/${job.id}`)
    }
  } else {
    lines.push('')
    lines.push('🧾 No jobs on file yet.')
  }

  lines.push('')
  lines.push(`Admin: ${ADMIN_BASE_URL}/admin/conversations?source=inbound`)
  return lines.join('\n')
}

// ── Inbound: SMS → Telegram topic ───────────────────────────────────────────

/**
 * Get the customer's topic, creating it (with a contact card) on first contact.
 * One topic per phone — reused regardless of which group/number, so a person is
 * never split across threads. Returns null if the relay can't run right now
 * (group not discovered yet, Telegram error) — caller treats that as a no-op.
 */
async function getOrCreateThread(params: {
  supabase: SupabaseClient
  phone: string
  isLsa: boolean
  today: string
}): Promise<RelayThread | null> {
  const { supabase, phone, isLsa, today } = params

  const existing = await findThreadByPhone(supabase, phone)
  if (existing) return existing

  // New customer → pick the destination group and build the card.
  const role: RelayRole = isLsa ? 'lsa' : 'customers'
  const groupChatId = await getRelayGroupChatId(supabase, role)
  if (!groupChatId) {
    console.warn(
      `[relay] No "${role}" group discovered yet — cannot create topic for ${phone}`,
    )
    return null
  }

  let context: InboundSmsCustomerContext | null = null
  try {
    context = await getInboundSmsCustomerContext(supabase, phone, today)
  } catch (error) {
    console.error('[relay] customer context lookup failed:', error)
  }

  const displayName = context?.customer.name || formatUsPhone(phone)
  const topicName = isLsa ? `LSA · ${displayName}` : displayName

  const topicId = await createForumTopic(groupChatId, topicName)
  if (!topicId) return null

  // Post the contact card as the first message in the new topic.
  await postToTopic(groupChatId, topicId, renderContactCardText(phone, context))

  const row = {
    phone,
    group_chat_id: groupChatId,
    topic_id: topicId,
    customer_name: context?.customer.name ?? null,
    is_lsa: isLsa,
  }
  // Upsert on phone to be safe against a racing duplicate inbound.
  const { data, error } = await supabase
    .from('telegram_relay_threads')
    .upsert(row, { onConflict: 'phone' })
    .select(THREAD_FIELDS)
    .maybeSingle()
  if (error) {
    console.error('[relay] Failed to persist thread:', error.message)
    return {
      id: '',
      business_number: null,
      ...row,
    } as RelayThread
  }
  return data as RelayThread
}

/**
 * Forward an inbound customer SMS into the customer's Telegram topic. Records
 * the business number they texted so the reply goes back from the same line.
 * Fails soft — returns {forwarded:false, reason} and never throws.
 */
export async function forwardInboundToRelay(params: {
  supabase: SupabaseClient
  phone: string
  message: string
  businessNumber: string | null
  isLsa: boolean
  today: string
  media?: StoredInboundMedia[]
  customerId?: string | null
}): Promise<{ forwarded: boolean; reason?: string }> {
  const {
    supabase,
    phone,
    message,
    businessNumber,
    isLsa,
    today,
    media = [],
    customerId,
  } = params
  try {
    const thread = await getOrCreateThread({ supabase, phone, isLsa, today })
    if (!thread) return { forwarded: false, reason: 'no-thread' }

    const availableMedia = media.filter(
      (item) => item.status === 'available' && Boolean(item.signedUrl),
    )
    let posted = false
    if (availableMedia.length > 0) {
      for (const [index, item] of availableMedia.entries()) {
        const mediaPosted = await postInboundMediaToTopic({
          chatId: Number(thread.group_chat_id),
          topicId: thread.topic_id,
          media: item,
          caption: index === 0 ? message : undefined,
        })
        posted = posted || mediaPosted
      }
      if (availableMedia.length < media.length) {
        await postToTopic(
          Number(thread.group_chat_id),
          thread.topic_id,
          '⚠️ One or more customer attachments could not be stored. The Twilio copy remains available for recovery.',
        )
      }
    } else {
      posted = await postInboundTextToTopic({
        chatId: Number(thread.group_chat_id),
        topicId: thread.topic_id,
        text: message,
        concernThreadId: customerId ? thread.id : null,
      })
      if (media.length > 0) {
        await postToTopic(
          Number(thread.group_chat_id),
          thread.topic_id,
          '⚠️ The customer sent media, but it could not be delivered to Telegram. The Twilio copy remains available for recovery.',
        )
      }
    }
    if (!posted) return { forwarded: false, reason: 'post-failed' }

    // Remember which number they texted (719 vs 866) for the reply, and keep
    // the latest seen timestamp current.
    if (businessNumber && businessNumber !== thread.business_number) {
      await supabase
        .from('telegram_relay_threads')
        .update({
          business_number: businessNumber,
          updated_at: new Date().toISOString(),
        })
        .eq('phone', phone)
    } else {
      await supabase
        .from('telegram_relay_threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('phone', phone)
    }

    return { forwarded: true }
  } catch (error) {
    console.error('[relay] forwardInboundToRelay error:', error)
    return { forwarded: false, reason: 'exception' }
  }
}

export async function handleCustomerMediaCallback(params: {
  supabase: SupabaseClient
  callbackQueryId: string
  data: string
  chatId: number
  messageId: number
  topicId?: number
}): Promise<boolean> {
  const { supabase, callbackQueryId, data, chatId, messageId, topicId } = params
  const concernMatch = data.match(/^concern:(thread|media):([0-9a-f-]{36})$/i)
  if (concernMatch) {
    try {
      const source = concernMatch[1].toLowerCase()
      const id = concernMatch[2]
      const result =
        source === 'thread'
          ? await (async () => {
              const { data: thread, error } = await supabase
                .from('telegram_relay_threads')
                .select('phone, business_number')
                .eq('id', id)
                .maybeSingle()
              if (error) throw error
              if (!thread) throw new Error('Customer topic was not found.')
              return openServiceConcernFromPhone({
                supabase,
                phone: thread.phone,
                source: 'telegram_text',
                businessNumber: thread.business_number,
              })
            })()
          : await (async () => {
              const { data: media, error } = await supabase
                .from('ops_customer_media')
                .select('customer_id, business_number')
                .eq('id', id)
                .maybeSingle()
              if (error) throw error
              if (!media?.customer_id) {
                throw new Error(
                  'Identify the customer before opening a concern.',
                )
              }
              return openServiceConcern({
                supabase,
                customerId: media.customer_id,
                source: 'telegram_media',
                businessNumber: media.business_number,
                mediaIds: [id],
              })
            })()

      if (result.intakeError) {
        await callTelegram('answerCallbackQuery', {
          callback_query_id: callbackQueryId,
          text: `Concern saved, but the intake text failed: ${result.intakeError}`.slice(
            0,
            200,
          ),
          show_alert: true,
        })
        return true
      }

      await callTelegram('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text: result.created
          ? 'Service concern opened and intake text sent.'
          : result.intakeSent
            ? 'Existing concern found and intake text sent.'
            : 'This customer already has an open service concern.',
      })
      await callTelegram('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      })
      if (typeof topicId === 'number') {
        await postToTopic(
          chatId,
          topicId,
          `✅ ${result.created ? 'Service concern opened.' : 'Existing service concern updated.'} Review it at ${ADMIN_BASE_URL}/admin/operations/service-concerns`,
        )
      }
      return true
    } catch (error) {
      console.error('[relay] Service concern action failed:', error)
      await callTelegram('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text:
          error instanceof Error
            ? error.message.slice(0, 200)
            : 'The service concern could not be opened.',
        show_alert: true,
      })
      return true
    }
  }

  const match = data.match(
    /^media:(customer_file|estimate|job|preexisting_damage):([0-9a-f-]{36})$/i,
  )
  if (!match) return false

  let result: Awaited<ReturnType<typeof classifyCustomerMedia>>
  try {
    result = await classifyCustomerMedia(
      supabase,
      match[2],
      match[1] as 'customer_file' | 'estimate' | 'job' | 'preexisting_damage',
    )
  } catch (error) {
    console.error('[relay] Customer media classification failed:', error)
    await callTelegram('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: 'The photo could not be saved. Please try again.',
      show_alert: true,
    })
    return true
  }

  await callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: result.message.slice(0, 200),
    show_alert: !result.ok,
  })

  if (result.ok) {
    await callTelegram('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    })
    if (typeof topicId === 'number') {
      await postToTopic(chatId, topicId, `✅ ${result.message}`)
    }
  }

  return true
}

// ── Outbound: Telegram topic reply → SMS ────────────────────────────────────

/**
 * A reply Charles typed in a customer's topic → send it to that customer as an
 * SMS from the same business number they texted (falls back to the default
 * Twilio number if unknown). Fails soft.
 */
/**
 * Resolve the display name for whoever typed a relay reply, from their Telegram
 * user id. Known operators (relay_operators) win; otherwise we fall back to the
 * sender's Telegram first name, then a generic label. Fail-open by design — the
 * relay must never refuse to send just because an operator isn't mapped yet.
 */
export async function resolveRelayOperator(
  supabase: SupabaseClient,
  telegramUserId: number | null,
  fallbackName?: string | null,
): Promise<string> {
  if (telegramUserId) {
    const { data } = await supabase
      .from('relay_operators')
      .select('display_name')
      .eq('telegram_user_id', telegramUserId)
      .eq('is_active', true)
      .maybeSingle()
    if (data?.display_name) return data.display_name as string
  }
  const fallback = fallbackName?.trim()
  return fallback && fallback.length > 0 ? fallback : 'Team'
}

/**
 * Register whoever typed /whoami in a relay group as a named operator, so their
 * replies get labeled with their name. This is how a new person (Tiffany, a
 * future tech) onboards themselves — no copying Telegram ids out of logs.
 *
 * Safe by design: everyone in these private groups can already relay SMS, so
 * registering only sets the display name — it grants no new capability.
 * Returns the message to post back into the group.
 */
export async function registerRelayOperator(params: {
  supabase: SupabaseClient
  telegramUserId: number
  fallbackName?: string | null
}): Promise<string> {
  const { supabase, telegramUserId, fallbackName } = params

  const { data: existing } = await supabase
    .from('relay_operators')
    .select('display_name')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle()

  if (existing?.display_name) {
    return `✅ Already set up — your replies show as "${existing.display_name}" (Telegram id ${telegramUserId}).`
  }

  const name = fallbackName?.trim() || `Operator ${telegramUserId}`
  const { error } = await supabase
    .from('relay_operators')
    .insert({ telegram_user_id: telegramUserId, display_name: name })

  if (error) {
    console.error('[relay] Failed to register operator:', error.message)
    return `⚠️ Could not register automatically. Your Telegram id is ${telegramUserId} — send it to Charles.`
  }

  return `✅ Registered as "${name}" (Telegram id ${telegramUserId}). Your replies to customers will now be labeled with your name.`
}

/**
 * Record a relayed outbound reply into the customer's conversation, attributed
 * to the operator who sent it, so the invoice message log shows who answered.
 * Stamped with the Twilio SID so the inbound webhook's outbound-sync dedupes it.
 * Never throws — attribution is best-effort, the SMS has already gone out.
 */
async function recordRelayOutbound(params: {
  supabase: SupabaseClient
  phone: string
  text: string
  twilioSid: string
  operator: string
}): Promise<void> {
  const { supabase, phone, text, twilioSid, operator } = params
  try {
    const { data: convo } = await supabase
      .from('conversations')
      .select('id, messages')
      .eq('phone_number', phone)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!convo?.id) return

    const messages = Array.isArray(convo.messages)
      ? (convo.messages as Array<Record<string, unknown>>)
      : []
    if (messages.some((m) => m?.twilio_sid && m.twilio_sid === twilioSid))
      return

    messages.push({
      role: 'assistant',
      content: text,
      timestamp: new Date().toISOString(),
      twilio_sid: twilioSid,
      sent_by: operator,
    })
    await supabase
      .from('conversations')
      .update({ messages, updated_at: new Date().toISOString() })
      .eq('id', convo.id)
  } catch (error) {
    console.error('[relay] Failed to record outbound to conversation:', error)
  }
}

export async function relayTopicReplyToSms(params: {
  supabase: SupabaseClient
  groupChatId: number
  topicId: number
  text: string
  operatorTelegramId?: number | null
  operatorFallbackName?: string | null
}): Promise<{
  sent: boolean
  reason?: string
  to?: string
  from?: string
  operator?: string
}> {
  const {
    supabase,
    groupChatId,
    topicId,
    text,
    operatorTelegramId,
    operatorFallbackName,
  } = params
  const thread = await findThreadByTopic(supabase, groupChatId, topicId)
  if (!thread) return { sent: false, reason: 'unmapped-topic' }

  const operator = await resolveRelayOperator(
    supabase,
    operatorTelegramId ?? null,
    operatorFallbackName ?? null,
  )

  try {
    const result = await sendCustomerSMSWithResult(
      thread.phone,
      text,
      undefined,
      'telegram_relay',
      thread.business_number ?? undefined,
    )
    await recordRelayOutbound({
      supabase,
      phone: thread.phone,
      text,
      twilioSid: result.sid,
      operator,
    })
    // Confirm delivery in the topic, attributed, so the other operator sees the
    // customer has already been answered (and by whom).
    await postToTopic(groupChatId, topicId, `✅ Sent to customer · ${operator}`)
    return { sent: true, to: result.to, from: result.from, operator }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'send-failed'
    console.error(`[relay] SMS send failed for ${thread.phone}:`, reason)
    // Surface a failed send in the same topic so it is never silent.
    await postToTopic(
      groupChatId,
      topicId,
      `⚠️ SMS NOT sent (${operator}): ${reason}`,
    )
    return { sent: false, reason, operator }
  }
}
