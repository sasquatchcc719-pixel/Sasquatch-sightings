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

/** Post a plain-text message into a forum topic. Returns success. */
export async function postToTopic(
  chatId: number,
  topicId: number,
  text: string,
): Promise<boolean> {
  const result = await callTelegram('sendMessage', {
    chat_id: chatId,
    message_thread_id: topicId,
    text,
    disable_web_page_preview: true,
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
}): Promise<{ forwarded: boolean; reason?: string }> {
  const { supabase, phone, message, businessNumber, isLsa, today } = params
  try {
    const thread = await getOrCreateThread({ supabase, phone, isLsa, today })
    if (!thread) return { forwarded: false, reason: 'no-thread' }

    const posted = await postToTopic(
      Number(thread.group_chat_id),
      thread.topic_id,
      message,
    )
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

// ── Outbound: Telegram topic reply → SMS ────────────────────────────────────

/**
 * A reply Charles typed in a customer's topic → send it to that customer as an
 * SMS from the same business number they texted (falls back to the default
 * Twilio number if unknown). Fails soft.
 */
export async function relayTopicReplyToSms(params: {
  supabase: SupabaseClient
  groupChatId: number
  topicId: number
  text: string
}): Promise<{ sent: boolean; reason?: string; to?: string; from?: string }> {
  const { supabase, groupChatId, topicId, text } = params
  const thread = await findThreadByTopic(supabase, groupChatId, topicId)
  if (!thread) return { sent: false, reason: 'unmapped-topic' }

  try {
    const result = await sendCustomerSMSWithResult(
      thread.phone,
      text,
      undefined,
      'telegram_relay',
      thread.business_number ?? undefined,
    )
    return { sent: true, to: result.to, from: result.from }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'send-failed'
    console.error(`[relay] SMS send failed for ${thread.phone}:`, reason)
    // Let Charles know in the same topic so a failed send is never silent.
    await postToTopic(groupChatId, topicId, `⚠️ SMS NOT sent: ${reason}`)
    return { sent: false, reason }
  }
}
