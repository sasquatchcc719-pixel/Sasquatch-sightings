/**
 * Telegram webhook for Harry Command bot
 * AI-powered conversational interface for Charles to manage customer conversations
 */

import { createHash, randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createAdminClient } from '@/supabase/server'
import { sendCustomerSMSWithResult } from '@/lib/twilio'
import { sendToCharles } from '@/lib/harry-command-bot'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * Get current time in Mountain Time (Colorado Springs)
 */
function getMountainTime(): Date {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }),
  )
}

/**
 * Get today's date in YYYY-MM-DD format (Mountain Time)
 */
function getTodayMountain(): string {
  return getMountainTime().toLocaleDateString('en-CA') // YYYY-MM-DD format
}

/**
 * Get tomorrow's date in YYYY-MM-DD format (Mountain Time)
 */
function getTomorrowMountain(): string {
  const tomorrow = getMountainTime()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow.toLocaleDateString('en-CA')
}

function getEndOfYearMountain(): string {
  const now = getMountainTime()
  return `${now.getFullYear()}-12-31`
}

type HarryCustomer = {
  id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  business_name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  created_at: string | null
}

type JobDetailLineItem = {
  name_snapshot: string | null
  notes: string | null
  quantity: number | string | null
  line_total: number | string | null
}

type PendingSmsDraftNotice = {
  id: string
  target: string
  phoneNumber: string
  message: string
}

type CommandThread = {
  id: string
  telegram_chat_id: string
  telegram_user_id: string | null
  last_customer_id: string | null
  last_artifact_id: string | null
}

type CommandArtifact = {
  id: string
  thread_id: string
  artifact_type: string
  title: string
  content: string
  customer_id: string | null
  conversation_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

type CommandActionPayload = {
  kind: 'send_customer_sms'
  targetLabel: string
  phoneNumber: string
  message: string
  conversationId?: string | null
  artifactId?: string | null
}

type CommandActionRow = {
  id: string
  thread_id: string
  action_type: string
  action_payload: CommandActionPayload
  payload_hash: string
  target_label: string | null
  preview: string
  status: string
  expires_at: string
  telegram_user_id: string | null
}

const CUSTOMER_SELECT =
  'id, full_name, first_name, last_name, business_name, phone, email, notes, created_at'

const COMMAND_ACTION_TTL_MS = 30 * 60 * 1000

function displayCustomerName(
  customer: Pick<HarryCustomer, 'full_name' | 'business_name'>,
): string {
  return customer.business_name || customer.full_name
}

type TelegramUpdate = {
  update_id?: number
  message?: {
    message_id: number
    from: {
      id: number
      first_name: string
    }
    chat: {
      id: number
    }
    text?: string
  }
  callback_query?: {
    id: string
    from: {
      id: number
    }
    message: {
      message_id: number
      chat: {
        id: number
      }
    }
    data: string
  }
}

function normalizePayloadForHash(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map(normalizePayloadForHash)
  }

  if (payload && typeof payload === 'object') {
    return Object.keys(payload as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        normalized[key] = normalizePayloadForHash(
          (payload as Record<string, unknown>)[key],
        )
        return normalized
      }, {})
  }

  return payload
}

function hashPayload(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizePayloadForHash(payload)))
    .digest('hex')
}

function getAllowedTelegramUserIds(): Set<string> {
  const raw = [
    process.env.HARRY_COMMAND_ALLOWED_TELEGRAM_USER_IDS,
    process.env.CHARLES_TELEGRAM_USER_ID,
    process.env.CHARLES_TELEGRAM_CHAT_ID,
  ]
    .filter(Boolean)
    .join(',')

  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

function isAllowedTelegramUser(userId?: number): boolean {
  const allowed = getAllowedTelegramUserIds()
  if (allowed.size === 0) return true
  return Boolean(userId && allowed.has(String(userId)))
}

function verifyTelegramSecret(request: NextRequest): boolean {
  const expected = process.env.HARRY_COMMAND_TELEGRAM_SECRET_TOKEN
  if (!expected) return true
  return request.headers.get('x-telegram-bot-api-secret-token') === expected
}

function looksLikeSendPreviousArtifact(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    /\b(text|send|message)\b/.test(lower) &&
    /\b(that|it|the report|the schedule|what you just sent|message you just sent)\b/.test(
      lower,
    )
  )
}

function extractTargetFromSendRequest(text: string): string | null {
  const patterns = [
    /\b(?:to|for)\s+([^?.!,]+?)(?:\s+with|\s+at\s*$|[?.!,]|$)/i,
    /\b(?:text|send|message)\s+([^?.!,]+?)(?:\s+that|\s+the|\s+with|[?.!,]|$)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim()
  }

  return null
}

function trimForSmsArtifact(content: string): string {
  return content
    .replace(/\*\*/g, '')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim()
}

export async function POST(request: NextRequest) {
  try {
    if (!verifyTelegramSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const update = (await request.json()) as TelegramUpdate
    const actorId = update.message?.from.id || update.callback_query?.from.id
    if (!isAllowedTelegramUser(actorId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createAdminClient()
    const chatId =
      update.message?.chat.id || update.callback_query?.message.chat.id || null
    const thread = chatId
      ? await getOrCreateCommandThread(supabase, chatId, actorId || null)
      : null

    if (update.update_id != null) {
      const isDuplicate = await recordTelegramUpdate(
        supabase,
        update.update_id,
        thread?.id || null,
      )
      if (isDuplicate) return NextResponse.json({ ok: true, duplicate: true })
    }

    // Handle text commands
    if (update.message?.text) {
      if (!thread) throw new Error('Missing Telegram thread')
      await handleTextCommand(
        update.message.text,
        update.message.chat.id,
        update.message.from.id,
        update.message.message_id,
        thread,
      )
    }

    // Handle button clicks
    if (update.callback_query) {
      await handleButtonClick(
        update.callback_query.data,
        update.callback_query.from.id,
        thread,
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Harry Command webhook error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * Handle text messages from Charles using AI
 */
async function getOrCreateCommandThread(
  supabase: ReturnType<typeof createAdminClient>,
  chatId: number,
  userId: number | null,
): Promise<CommandThread> {
  const chatIdText = String(chatId)
  const { data: existing } = await supabase
    .from('harry_command_threads')
    .select(
      'id, telegram_chat_id, telegram_user_id, last_customer_id, last_artifact_id',
    )
    .eq('telegram_chat_id', chatIdText)
    .maybeSingle()

  if (existing) return existing as CommandThread

  const { data, error } = await supabase
    .from('harry_command_threads')
    .insert({
      telegram_chat_id: chatIdText,
      telegram_user_id: userId ? String(userId) : null,
    })
    .select(
      'id, telegram_chat_id, telegram_user_id, last_customer_id, last_artifact_id',
    )
    .single()

  if (error) throw error
  return data as CommandThread
}

async function recordTelegramUpdate(
  supabase: ReturnType<typeof createAdminClient>,
  updateId: number,
  threadId: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('harry_command_telegram_updates')
    .insert({
      update_id: updateId,
      thread_id: threadId,
    })

  if (!error) return false
  if (error.code === '23505') return true
  throw error
}

async function logCommandMessage(
  supabase: ReturnType<typeof createAdminClient>,
  params: {
    threadId: string
    role: 'owner' | 'assistant' | 'tool' | 'system'
    content: string
    telegramMessageId?: number | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await supabase.from('harry_command_messages').insert({
    thread_id: params.threadId,
    telegram_message_id: params.telegramMessageId || null,
    role: params.role,
    content: params.content,
    metadata: params.metadata || {},
  })
  if (error) throw error
}

async function getRecentCommandMessages(
  supabase: ReturnType<typeof createAdminClient>,
  threadId: string,
): Promise<Array<{ role: string; content: string; created_at: string }>> {
  const { data, error } = await supabase
    .from('harry_command_messages')
    .select('role, content, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(12)

  if (error) throw error
  return (data || []).reverse()
}

async function getLatestArtifact(
  supabase: ReturnType<typeof createAdminClient>,
  threadId: string,
): Promise<CommandArtifact | null> {
  const { data, error } = await supabase
    .from('harry_command_artifacts')
    .select(
      'id, thread_id, artifact_type, title, content, customer_id, conversation_id, metadata, created_at',
    )
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as CommandArtifact | null) || null
}

async function saveArtifact(
  supabase: ReturnType<typeof createAdminClient>,
  params: {
    threadId: string
    type: string
    title: string
    content: string
    customerId?: string | null
    conversationId?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<CommandArtifact> {
  const { data, error } = await supabase
    .from('harry_command_artifacts')
    .insert({
      thread_id: params.threadId,
      artifact_type: params.type,
      title: params.title,
      content: params.content,
      customer_id: params.customerId || null,
      conversation_id: params.conversationId || null,
      metadata: params.metadata || {},
    })
    .select(
      'id, thread_id, artifact_type, title, content, customer_id, conversation_id, metadata, created_at',
    )
    .single()

  if (error) throw error
  await supabase
    .from('harry_command_threads')
    .update({
      last_artifact_id: data.id,
      last_customer_id: params.customerId || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.threadId)

  return data as CommandArtifact
}

async function createPendingCommandAction(
  supabase: ReturnType<typeof createAdminClient>,
  params: {
    threadId: string
    action: CommandActionPayload
    targetLabel: string
    preview: string
    telegramUserId?: number | null
  },
): Promise<CommandActionRow> {
  const actionId = randomUUID()
  const expiresAt = new Date(Date.now() + COMMAND_ACTION_TTL_MS).toISOString()
  const { data, error } = await supabase
    .from('harry_command_pending_actions')
    .insert({
      id: actionId,
      thread_id: params.threadId,
      action_type: params.action.kind,
      action_payload: params.action,
      payload_hash: hashPayload(params.action),
      target_label: params.targetLabel,
      preview: params.preview,
      telegram_user_id: params.telegramUserId
        ? String(params.telegramUserId)
        : null,
      expires_at: expiresAt,
    })
    .select(
      'id, thread_id, action_type, action_payload, payload_hash, target_label, preview, status, expires_at, telegram_user_id',
    )
    .single()

  if (error) throw error
  return data as CommandActionRow
}

async function writeCommandAudit(
  supabase: ReturnType<typeof createAdminClient>,
  params: {
    threadId?: string | null
    pendingActionId?: string | null
    actionType: string
    status: string
    targetLabel?: string | null
    reason?: string | null
    payload?: Record<string, unknown>
    result?: Record<string, unknown>
    telegramUserId?: number | null
  },
): Promise<void> {
  await supabase.from('harry_command_action_audit').insert({
    thread_id: params.threadId || null,
    pending_action_id: params.pendingActionId || null,
    action_type: params.actionType,
    status: params.status,
    target_label: params.targetLabel || null,
    reason: params.reason || null,
    payload: params.payload || {},
    result: params.result || {},
    telegram_user_id: params.telegramUserId
      ? String(params.telegramUserId)
      : null,
  })
}

async function handleSendLatestArtifactRequest(
  text: string,
  thread: CommandThread,
  artifact: CommandArtifact,
  userId: number,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<boolean> {
  const targetText = extractTargetFromSendRequest(text)
  let customer: HarryCustomer | null = null

  if (targetText) {
    const candidates = await findCustomerCandidates(targetText, supabase)
    if (candidates.length > 1) {
      const reply = `I found a few possible matches for "${targetText}". Pick the one to text.`
      await logCommandMessage(supabase, {
        threadId: thread.id,
        role: 'assistant',
        content: reply,
        metadata: {
          artifact_id: artifact.id,
          candidates: candidates.map((candidate) => candidate.id),
        },
      })
      await sendToCharles(reply, {
        buttons: candidates.slice(0, 5).map((candidate) => [
          {
            text: `${displayCustomerName(candidate)}${candidate.phone ? ` ${candidate.phone}` : ''}`.slice(
              0,
              60,
            ),
            data: `selectcust_${candidate.id}`,
          },
        ]),
      })
      return true
    }
    customer = candidates[0] || null
  }

  if (!customer && artifact.customer_id) {
    const { data } = await supabase
      .from('ops_customers')
      .select(CUSTOMER_SELECT)
      .eq('id', artifact.customer_id)
      .maybeSingle()
    customer = (data as HarryCustomer | null) || null
  }

  if (!customer?.phone) {
    const reply = targetText
      ? `I found the saved report, but I couldn't resolve "${targetText}" to a customer with a phone number. Give me the phone or pick the exact customer.`
      : "I found the saved report, but I don't know who to send it to. Tell me the customer or phone number."
    await logCommandMessage(supabase, {
      threadId: thread.id,
      role: 'assistant',
      content: reply,
    })
    await sendToCharles(reply)
    return true
  }

  await createArtifactSmsApproval(thread, artifact, customer, userId, supabase)
  return true
}

async function createArtifactSmsApproval(
  thread: CommandThread,
  artifact: CommandArtifact,
  customer: HarryCustomer,
  userId: number,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<void> {
  if (!customer.phone) {
    await sendToCharles(
      `❌ ${displayCustomerName(customer)} has no phone number.`,
    )
    return
  }

  const conversation = await findConversation(customer.phone, supabase)
  const message = trimForSmsArtifact(artifact.content)
  const targetLabel = displayCustomerName(customer)
  const action = await createPendingCommandAction(supabase, {
    threadId: thread.id,
    telegramUserId: userId,
    targetLabel,
    preview: message,
    action: {
      kind: 'send_customer_sms',
      targetLabel,
      phoneNumber: customer.phone,
      message,
      conversationId: conversation?.id || null,
      artifactId: artifact.id,
    },
  })

  await writeCommandAudit(supabase, {
    threadId: thread.id,
    pendingActionId: action.id,
    actionType: action.action_type,
    status: 'proposed',
    targetLabel,
    reason: 'Owner asked to send saved artifact',
    payload: action.action_payload,
    telegramUserId: userId,
  })

  const reply = `Draft ready for ${targetLabel} (${customer.phone}). It uses the saved report "${artifact.title}". Send it?`
  await logCommandMessage(supabase, {
    threadId: thread.id,
    role: 'assistant',
    content: reply,
    metadata: { artifact_id: artifact.id, pending_action_id: action.id },
  })
  await sendToCharles(`${reply}\n\n${message.slice(0, 2800)}`, {
    buttons: [
      [
        { text: 'Send SMS', data: `approveaction_${action.id}` },
        { text: 'Cancel', data: `cancelaction_${action.id}` },
      ],
    ],
  })
}

async function handleTextCommand(
  text: string,
  chatId: number,
  userId: number,
  messageId: number,
  thread: CommandThread,
): Promise<void> {
  const supabase = createAdminClient()

  try {
    void chatId
    await logCommandMessage(supabase, {
      threadId: thread.id,
      role: 'owner',
      content: text,
      telegramMessageId: messageId,
      metadata: { telegram_user_id: userId },
    })

    const latestArtifact = await getLatestArtifact(supabase, thread.id)
    if (latestArtifact && looksLikeSendPreviousArtifact(text)) {
      const handled = await handleSendLatestArtifactRequest(
        text,
        thread,
        latestArtifact,
        userId,
        supabase,
      )
      if (handled) return
    }

    const recentCommandMessages = await getRecentCommandMessages(
      supabase,
      thread.id,
    )
    const now = getMountainTime()
    const currentTime = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Denver',
    })
    const currentDate = now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/Denver',
    })

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `You are Harry Command Bot, Charles's personal AI assistant for managing his carpet cleaning business.

Charles owns Sasquatch Carpet Cleaning in Colorado Springs, CO. You help him manage customer conversations, send messages, and control Harry (the AI that handles customer SMS).

CURRENT TIME: ${currentTime} Mountain Time
CURRENT DATE: ${currentDate}

IMPORTANT: All scheduling is done in Mountain Time (America/Denver timezone). When Charles says "today" or "tomorrow", use the current Mountain Time date shown above.

Your capabilities:
- Send SMS messages to customers
- View conversation threads
- Enable/disable Harry for specific conversations
- List recent active conversations
- Answer questions about customer interactions
- Add jobs/appointments to the schedule
- View the schedule
- Modify existing appointments
- Cancel/delete appointments
- Look up customer details
- View customer job history
- Search job line items, descriptions, rooms, buildings, and service notes
- Mark jobs as complete
- Add new customers to the system
- Check schedule availability
- View/update payment status
- Add notes to jobs
- Get daily business summary

Voice:
- Sound like a sharp employee who knows the business, not a generic chatbot.
- Be brief, direct, and useful. Charles is texting from his phone while working.
- If the data is missing or only partially imported, say that plainly.
- You are allowed a little personality: competent shop manager, direct, lightly dry, never gushy.
- Treat Charles's messages as directions from the owner. When he asks for an operational outcome, use tools to gather the data and complete the requested prep work.
- Only ask a follow-up when the target customer, date range, or requested action is genuinely unclear.
- When asked for a customer's schedule, year schedule, upcoming jobs, dates/services/notes, or work to send to a customer, use customer_schedule_summary. Do not use search_job_details unless Charles asks for a specific room/building/service/detail phrase.
- When Charles asks you to text a customer, draft the SMS with send_sms. The system will ask Charles to approve before sending; never claim it was sent until approval happens.
- When Charles says "that", "it", "same thing", or "the report", use RECENT COMMAND MEMORY and LAST ARTIFACT before asking what he means.
- When asked "when did we last..." or about a room/building/scope, use search_job_details so you can inspect line-item descriptions before answering.

RECENT COMMAND MEMORY:
${
  recentCommandMessages
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content.slice(0, 1200)}`)
    .join('\n\n') || '(none)'
}

LAST ARTIFACT:
${
  latestArtifact
    ? `${latestArtifact.title}\n${latestArtifact.content.slice(0, 2500)}`
    : '(none)'
}`,
      },
      { role: 'user', content: text },
    ]

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'send_sms',
          description:
            'Send an SMS message to a customer. Use this when Charles wants to text someone.',
          parameters: {
            type: 'object',
            properties: {
              target: {
                type: 'string',
                description:
                  'Customer name or phone number (e.g., "Ann", "Sally", "7195551234")',
              },
              message: {
                type: 'string',
                description: 'The message to send to the customer',
              },
            },
            required: ['target', 'message'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'view_conversation',
          description:
            'View the full conversation thread with a customer. Shows recent messages and Harry status.',
          parameters: {
            type: 'object',
            properties: {
              target: {
                type: 'string',
                description:
                  'Customer name or phone number (e.g., "Ann", "7195551234")',
              },
            },
            required: ['target'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'take_over_conversation',
          description:
            'Disable Harry for a conversation so Charles can handle it manually.',
          parameters: {
            type: 'object',
            properties: {
              target: {
                type: 'string',
                description: 'Customer name or phone number',
              },
            },
            required: ['target'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'enable_harry',
          description:
            'Re-enable Harry to handle a conversation automatically.',
          parameters: {
            type: 'object',
            properties: {
              target: {
                type: 'string',
                description: 'Customer name or phone number',
              },
            },
            required: ['target'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_recent_conversations',
          description:
            'List recent active customer conversations with their status.',
          parameters: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Number of conversations to show (default 10)',
              },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'add_appointment',
          description:
            'Add a new appointment/job to the schedule. Use this when Charles wants to schedule a job.',
          parameters: {
            type: 'object',
            properties: {
              customer_name: {
                type: 'string',
                description: 'Customer name (e.g., "Evan Cox", "John Smith")',
              },
              date: {
                type: 'string',
                description:
                  'Date in YYYY-MM-DD format. Tomorrow, today, specific date, etc.',
              },
              start_time: {
                type: 'string',
                description: 'Start time in HH:MM format (24-hour)',
              },
              duration_hours: {
                type: 'number',
                description: 'Duration in hours (default 1)',
              },
              notes: {
                type: 'string',
                description:
                  'Internal notes (e.g., "Warranty - spot popped back up")',
              },
            },
            required: ['customer_name', 'date', 'start_time'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'view_schedule',
          description:
            'View the schedule for a specific date. Shows all appointments.',
          parameters: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                description:
                  'Date in YYYY-MM-DD format, or "today", "tomorrow", specific weekday',
              },
            },
            required: ['date'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'update_appointment',
          description:
            'Update an existing appointment (reschedule, change notes, etc.)',
          parameters: {
            type: 'object',
            properties: {
              customer_name: {
                type: 'string',
                description: 'Customer name to find the appointment',
              },
              new_date: {
                type: 'string',
                description: 'New date (optional)',
              },
              new_start_time: {
                type: 'string',
                description: 'New start time (optional)',
              },
              new_notes: {
                type: 'string',
                description: 'New internal notes (optional)',
              },
            },
            required: ['customer_name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cancel_appointment',
          description: 'Cancel/delete an appointment from the schedule.',
          parameters: {
            type: 'object',
            properties: {
              customer_name: {
                type: 'string',
                description: 'Customer name to find the appointment',
              },
              date: {
                type: 'string',
                description:
                  'Optional: specific date if customer has multiple appointments',
              },
            },
            required: ['customer_name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'lookup_customer',
          description:
            'Look up customer details including phone, email, address, and notes.',
          parameters: {
            type: 'object',
            properties: {
              customer_name: {
                type: 'string',
                description: 'Customer name or phone number',
              },
            },
            required: ['customer_name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'customer_history',
          description:
            'View past jobs for a customer with dates, amounts, and status.',
          parameters: {
            type: 'object',
            properties: {
              customer_name: {
                type: 'string',
                description: 'Customer name',
              },
              limit: {
                type: 'number',
                description: 'Number of jobs to show (default 5)',
              },
            },
            required: ['customer_name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'customer_schedule_summary',
          description:
            'Fetch a customer schedule or job summary across a date range, including dates, services, line-item notes, internal notes, status, and totals. Use for requests like "send Recovery Village the rest of the year schedule" or "show all upcoming jobs for Lance."',
          parameters: {
            type: 'object',
            properties: {
              customer_name: {
                type: 'string',
                description:
                  'Customer, contact, or business name, e.g. "Lance Johnson at Recovery Village"',
              },
              from_date: {
                type: 'string',
                description:
                  'Start date in YYYY-MM-DD. Defaults to today in Mountain Time.',
              },
              to_date: {
                type: 'string',
                description:
                  'End date in YYYY-MM-DD. Defaults to the end of the current year.',
              },
              include_cancelled: {
                type: 'boolean',
                description: 'Include cancelled appointments. Default false.',
              },
              limit: {
                type: 'number',
                description: 'Maximum appointments to return. Default 80.',
              },
            },
            required: ['customer_name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_job_details',
          description:
            'Search a customer’s appointment line items, service descriptions, notes, room/building names, dates, times, status, and totals. Use this for questions like “when did we last clean the dining room?”, “what did we do in A building?”, or “show Recovery Village kitchen jobs.”',
          parameters: {
            type: 'object',
            properties: {
              customer_name: {
                type: 'string',
                description:
                  'Customer or business name, e.g. "Recovery Village"',
              },
              query: {
                type: 'string',
                description:
                  'Room, building, service, or phrase to search for, e.g. "dining room", "kitchen", "A building"',
              },
              include_future: {
                type: 'boolean',
                description:
                  'Include future booked jobs. Default false when asking what was last done; true when asking what is scheduled.',
              },
              limit: {
                type: 'number',
                description: 'Maximum matching jobs to return (default 5)',
              },
            },
            required: ['customer_name', 'query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'mark_complete',
          description:
            'Mark a job/appointment as completed. Updates status and completion timestamp.',
          parameters: {
            type: 'object',
            properties: {
              customer_name: {
                type: 'string',
                description: 'Customer name for the job',
              },
              date: {
                type: 'string',
                description:
                  'Date of the appointment (optional, defaults to today)',
              },
            },
            required: ['customer_name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'today_summary',
          description:
            "Get a summary of today's business: jobs, revenue, completion status.",
          parameters: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                description: 'Date to summarize (default today)',
              },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'add_customer',
          description: 'Add a new customer to the system.',
          parameters: {
            type: 'object',
            properties: {
              full_name: {
                type: 'string',
                description: 'Customer full name',
              },
              phone: {
                type: 'string',
                description: 'Phone number',
              },
              email: {
                type: 'string',
                description: 'Email address (optional)',
              },
              address: {
                type: 'string',
                description: 'Service address (optional)',
              },
              notes: {
                type: 'string',
                description: 'Internal notes (optional)',
              },
            },
            required: ['full_name', 'phone'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'check_availability',
          description:
            'Check if a time slot is available (no conflicting appointments).',
          parameters: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                description:
                  'Date to check (YYYY-MM-DD or "today", "tomorrow")',
              },
              start_time: {
                type: 'string',
                description: 'Start time in HH:MM format',
              },
              duration_hours: {
                type: 'number',
                description: 'Duration in hours (default 1)',
              },
            },
            required: ['date', 'start_time'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'payment_status',
          description: 'Check payment status for a job or mark it as paid.',
          parameters: {
            type: 'object',
            properties: {
              customer_name: {
                type: 'string',
                description: 'Customer name',
              },
              mark_paid: {
                type: 'boolean',
                description: 'Set to true to mark as paid',
              },
            },
            required: ['customer_name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'add_job_note',
          description: 'Add a note to a job/appointment.',
          parameters: {
            type: 'object',
            properties: {
              customer_name: {
                type: 'string',
                description: 'Customer name',
              },
              note: {
                type: 'string',
                description: 'Note to add',
              },
              date: {
                type: 'string',
                description:
                  'Date of the job (optional, defaults to next upcoming)',
              },
            },
            required: ['customer_name', 'note'],
          },
        },
      },
    ]

    let finalResponse = ''
    const smsDrafts: PendingSmsDraftNotice[] = []
    let scheduleSummaryResult: Record<string, unknown> | null = null

    for (let round = 0; round < 6; round += 1) {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.35,
        max_tokens: 1000,
      })

      const message = response.choices[0]?.message
      if (!message) break

      if (message.tool_calls && message.tool_calls.length > 0) {
        messages.push(message)

        for (const toolCall of message.tool_calls) {
          if (toolCall.type !== 'function') continue

          let args: Record<string, unknown>
          try {
            args = JSON.parse(toolCall.function.arguments || '{}')
          } catch {
            args = {}
          }

          const toolResult = await executeToolCall(
            toolCall.function.name,
            args,
            supabase,
            { smsDrafts, threadId: thread.id, telegramUserId: userId },
          )
          await logCommandMessage(supabase, {
            threadId: thread.id,
            role: 'tool',
            content: toolResult,
            metadata: {
              tool_name: toolCall.function.name,
              arguments: args,
            },
          })
          if (toolCall.function.name === 'customer_schedule_summary') {
            try {
              scheduleSummaryResult = JSON.parse(toolResult) as Record<
                string,
                unknown
              >
            } catch {
              scheduleSummaryResult = null
            }
          }
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          })
        }

        continue
      }

      finalResponse = (message.content || '').trim()
      break
    }

    const latestDraft = smsDrafts[smsDrafts.length - 1]
    if (!finalResponse && latestDraft) {
      finalResponse = `Draft ready for ${latestDraft.target} (${latestDraft.phoneNumber}):\n\n"${latestDraft.message}"\n\nSend it?`
    }

    if (finalResponse) {
      await logCommandMessage(supabase, {
        threadId: thread.id,
        role: 'assistant',
        content: finalResponse,
      })

      if (scheduleSummaryResult && !('error' in scheduleSummaryResult)) {
        const customer = scheduleSummaryResult.customer as
          | { id?: string; name?: string }
          | undefined
        await saveArtifact(supabase, {
          threadId: thread.id,
          type: 'customer_schedule_report',
          title: `Schedule report${customer?.name ? ` - ${customer.name}` : ''}`,
          content: finalResponse.trim(),
          customerId: customer?.id || null,
          metadata: scheduleSummaryResult,
        })
      }

      await sendToCharles(finalResponse.trim(), {
        buttons: latestDraft
          ? [
              [
                { text: 'Send SMS', data: `approveaction_${latestDraft.id}` },
                { text: 'Cancel', data: `cancelaction_${latestDraft.id}` },
              ],
            ]
          : undefined,
      })
    }
  } catch (error) {
    console.error('AI processing error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    await sendToCharles(
      `❌ Error: ${errorMessage}\n\nPlease contact support if this continues.`,
    )
  }
}

/**
 * Execute a tool call from Claude
 */
async function findCustomer(
  target: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<HarryCustomer | null> {
  const candidates = await findCustomerCandidates(target, supabase)
  return candidates[0] || null
}

async function findCustomerCandidates(
  target: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<HarryCustomer[]> {
  const cleanTarget = String(target || '').trim()
  if (!cleanTarget) return []
  const customers = new Map<string, HarryCustomer>()

  const phoneVariants = opsPhoneLookupVariants(cleanTarget)
  if (phoneVariants.length > 0) {
    const { data } = await supabase
      .from('ops_customers')
      .select(CUSTOMER_SELECT)
      .in('phone', phoneVariants)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(5)

    for (const customer of data || []) {
      customers.set(customer.id, customer as HarryCustomer)
    }
  }

  const targetParts = [cleanTarget]
  const atMatch = cleanTarget.match(/^(.+?)\s+(?:at|for)\s+(.+)$/i)
  if (atMatch) {
    targetParts.push(atMatch[2].trim(), atMatch[1].trim())
  }

  const searchableTargets = Array.from(
    new Set(targetParts.filter((part) => part.length > 0)),
  )
  const searchableColumns = ['business_name', 'full_name', 'email'] as const
  for (const searchableTarget of searchableTargets) {
    for (const column of searchableColumns) {
      const { data } = await supabase
        .from('ops_customers')
        .select(CUSTOMER_SELECT)
        .ilike(column, `%${searchableTarget}%`)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(5)

      for (const customer of data || []) {
        customers.set(customer.id, customer as HarryCustomer)
      }
    }
  }

  return Array.from(customers.values()).slice(0, 8)
}

async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  supabase: ReturnType<typeof createAdminClient>,
  context: {
    smsDrafts?: PendingSmsDraftNotice[]
    threadId?: string
    telegramUserId?: number
  } = {},
): Promise<string> {
  switch (toolName) {
    case 'send_sms': {
      const target = String(input.target)
      const message = String(input.message)
      const conversation = await findConversation(target, supabase)
      let phoneNumber = conversation?.phone_number || null
      let targetLabel = target

      if (!phoneNumber) {
        const customer = await findCustomer(target, supabase)
        if (customer?.phone) {
          phoneNumber = customer.phone
          targetLabel = displayCustomerName(customer)
        }
      }

      if (!phoneNumber) {
        return `❌ Couldn't find a phone number or conversation for "${target}"`
      }

      if (!context.threadId) {
        return '❌ Missing command thread for SMS approval.'
      }

      const action = await createPendingCommandAction(supabase, {
        threadId: context.threadId,
        telegramUserId: context.telegramUserId || null,
        targetLabel,
        preview: message,
        action: {
          kind: 'send_customer_sms',
          targetLabel,
          phoneNumber,
          message,
          conversationId: conversation?.id || null,
        },
      })

      await writeCommandAudit(supabase, {
        threadId: context.threadId,
        pendingActionId: action.id,
        actionType: action.action_type,
        status: 'proposed',
        targetLabel,
        reason: 'Owner requested customer SMS draft',
        payload: action.action_payload,
        telegramUserId: context.telegramUserId || null,
      })

      context.smsDrafts?.push({
        id: action.id,
        target: targetLabel,
        phoneNumber,
        message,
      })

      return `SMS draft created for ${targetLabel} (${phoneNumber}). It has not been sent yet and needs Charles approval. Draft: "${message}"`
    }

    case 'view_conversation': {
      const target = String(input.target)
      const conversation = await findConversation(target, supabase)

      if (!conversation) {
        return `❌ Couldn't find conversation for "${target}"`
      }

      const { data: conv } = await supabase
        .from('conversations')
        .select('phone_number, messages, ai_enabled, source')
        .eq('id', conversation.id)
        .single()

      if (!conv) {
        return '❌ Conversation not found'
      }

      const messages =
        (conv.messages as Array<{
          role: string
          content: string
          timestamp: string
        }>) || []

      const sourceLabel =
        conv.source === 'inbound'
          ? '📞 MAIN'
          : conv.source === 'Google LSA' || conv.source === 'lsa'
            ? '🔵 LSA'
            : '💬 OTHER'

      let thread = `${sourceLabel} | 📱 ${conv.phone_number}\n🤖 Harry: ${conv.ai_enabled ? 'ON' : 'OFF'}\n\n`

      const recentMessages = messages.slice(-10)
      for (const msg of recentMessages) {
        const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })
        const role = msg.role === 'user' ? '👤' : '🤖'
        const preview =
          msg.content.length > 200
            ? msg.content.substring(0, 200) + '...'
            : msg.content
        thread += `${time} ${role}: ${preview}\n\n`
      }

      return thread
    }

    case 'take_over_conversation': {
      const target = String(input.target)
      const conversation = await findConversation(target, supabase)

      if (!conversation) {
        return `❌ Couldn't find conversation for "${target}"`
      }

      await supabase
        .from('conversations')
        .update({ ai_enabled: false })
        .eq('id', conversation.id)

      return '✅ You took over - Harry is now disabled for this conversation'
    }

    case 'enable_harry': {
      const target = String(input.target)
      const conversation = await findConversation(target, supabase)

      if (!conversation) {
        return `❌ Couldn't find conversation for "${target}"`
      }

      await supabase
        .from('conversations')
        .update({ ai_enabled: true })
        .eq('id', conversation.id)

      return '✅ Harry is now enabled for this conversation'
    }

    case 'list_recent_conversations': {
      const limit = Number(input.limit) || 10

      const { data: conversations } = await supabase
        .from('conversations')
        .select('id, phone_number, messages, ai_enabled, source, updated_at')
        .order('updated_at', { ascending: false })
        .limit(limit)

      if (!conversations || conversations.length === 0) {
        return '📭 No recent conversations'
      }

      let list = '📋 Recent Conversations:\n\n'
      for (const conv of conversations) {
        const messages = (conv.messages as Array<{ content: string }>) || []
        const lastMsg = messages[messages.length - 1]?.content || 'No messages'
        const preview =
          lastMsg.length > 50 ? lastMsg.substring(0, 50) + '...' : lastMsg

        const sourceIcon =
          conv.source === 'inbound' ? '📞' : conv.source === 'lsa' ? '🔵' : '💬'
        const harryStatus = conv.ai_enabled ? '🤖' : '👤'

        list += `${sourceIcon} ${conv.phone_number} ${harryStatus}\n"${preview}"\n\n`
      }

      return list
    }

    case 'add_appointment': {
      const customerName = String(input.customer_name)
      const date = String(input.date)
      const startTime = String(input.start_time)
      const durationHours = Number(input.duration_hours) || 1
      const notes = input.notes ? String(input.notes) : null

      const customer = await findCustomer(customerName, supabase)

      if (!customer) {
        return `❌ Couldn't find customer "${customerName}". Make sure they exist in the system first.`
      }

      // Get their service address
      const { data: serviceAddress } = await supabase
        .from('ops_service_addresses')
        .select('id')
        .eq('customer_id', customer.id)
        .limit(1)
        .maybeSingle()

      // Calculate end time
      const [hours, minutes] = startTime.split(':').map(Number)
      const endHours = hours + durationHours
      const endTime = `${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`

      // Insert appointment
      const { data: newAppt, error } = await supabase
        .from('ops_appointments')
        .insert({
          customer_id: customer.id,
          service_address_id: serviceAddress?.id || null,
          appointment_date: date,
          start_time: startTime + ':00',
          end_time: endTime,
          status: 'booked',
          kind: 'service',
          internal_notes: notes,
          booking_channel: 'manual',
          source: 'owner',
        })
        .select('id, appointment_date, start_time, end_time')
        .single()

      if (error) {
        return `❌ Failed to create appointment: ${error.message}`
      }

      // Booking notification is handled by the Supabase DB trigger on ops_appointments INSERT

      const formattedDate = new Date(date).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
      const formattedTime = new Date(
        `2000-01-01 ${startTime}`,
      ).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })

      return `✅ Added ${displayCustomerName(customer)} to schedule\n📅 ${formattedDate} at ${formattedTime}\n⏱️ ${durationHours}h${notes ? `\n📝 ${notes}` : ''}`
    }

    case 'view_schedule': {
      let targetDate = String(input.date)

      // Handle relative dates (Mountain Time)
      if (targetDate.toLowerCase() === 'today') {
        targetDate = getTodayMountain()
      } else if (targetDate.toLowerCase() === 'tomorrow') {
        targetDate = getTomorrowMountain()
      }

      const { data: appointments } = await supabase
        .from('ops_appointments')
        .select(
          'id, appointment_date, start_time, end_time, status, internal_notes, customer_id',
        )
        .eq('appointment_date', targetDate)
        .order('start_time', { ascending: true })

      if (!appointments || appointments.length === 0) {
        const formattedDate = new Date(targetDate).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })
        return `📅 ${formattedDate}\n\nNo appointments scheduled`
      }

      // Get customer names
      const customerIds = appointments.map((a) => a.customer_id)
      const { data: customers } = await supabase
        .from('ops_customers')
        .select('id, full_name, business_name')
        .in('id', customerIds)

      const customerMap = new Map(
        customers?.map((c) => [c.id, displayCustomerName(c)]),
      )

      const formattedDate = new Date(targetDate).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })

      let schedule = `📅 ${formattedDate}\n\n`
      for (const appt of appointments) {
        const customerName =
          customerMap.get(appt.customer_id) || 'Unknown Customer'
        const time = new Date(
          `2000-01-01 ${appt.start_time}`,
        ).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })
        const statusIcon =
          appt.status === 'completed'
            ? '✅'
            : appt.status === 'booked'
              ? '📌'
              : '⏸️'

        schedule += `${statusIcon} ${time} - ${customerName}`
        if (appt.internal_notes) {
          schedule += `\n   📝 ${appt.internal_notes}`
        }
        schedule += '\n\n'
      }

      return schedule
    }

    case 'update_appointment': {
      const customerName = String(input.customer_name)
      const newDate = input.new_date ? String(input.new_date) : null
      const newStartTime = input.new_start_time
        ? String(input.new_start_time)
        : null
      const newNotes = input.new_notes ? String(input.new_notes) : null

      const customer = await findCustomer(customerName, supabase)

      if (!customer) {
        return `❌ Couldn't find customer "${customerName}"`
      }

      // Find their most recent upcoming appointment
      const { data: appointments } = await supabase
        .from('ops_appointments')
        .select('id, appointment_date, start_time, status')
        .eq('customer_id', customer.id)
        .gte('appointment_date', getTodayMountain())
        .order('appointment_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(1)

      if (!appointments || appointments.length === 0) {
        return `❌ No upcoming appointments found for ${displayCustomerName(customer)}`
      }

      const appt = appointments[0]

      // Build update object
      const updates: Record<string, string> = {}
      if (newDate) updates.appointment_date = newDate
      if (newStartTime) updates.start_time = newStartTime + ':00'
      if (newNotes) updates.internal_notes = newNotes

      if (Object.keys(updates).length === 0) {
        return '❌ No changes specified'
      }

      const { error } = await supabase
        .from('ops_appointments')
        .update(updates)
        .eq('id', appt.id)

      if (error) {
        return `❌ Failed to update: ${error.message}`
      }

      let response = `✅ Updated appointment for ${displayCustomerName(customer)}\n`
      if (newDate) response += `📅 New date: ${newDate}\n`
      if (newStartTime) response += `⏰ New time: ${newStartTime}\n`
      if (newNotes) response += `📝 Notes: ${newNotes}\n`

      return response.trim()
    }

    case 'cancel_appointment': {
      const customerName = String(input.customer_name)
      const targetDate = input.date ? String(input.date) : null

      const customer = await findCustomer(customerName, supabase)

      if (!customer) {
        return `❌ Couldn't find customer "${customerName}"`
      }

      // Find appointment
      let query = supabase
        .from('ops_appointments')
        .select('id, appointment_date, start_time, status')
        .eq('customer_id', customer.id)
        .gte('appointment_date', getTodayMountain())

      if (targetDate) {
        query = query.eq('appointment_date', targetDate)
      }

      const { data: appointments } = await query
        .order('appointment_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(1)

      if (!appointments || appointments.length === 0) {
        return `❌ No upcoming appointments found for ${displayCustomerName(customer)}`
      }

      const appt = appointments[0]

      // Soft cancel — never hard delete appointments
      const { error } = await supabase
        .from('ops_appointments')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', appt.id)

      if (error) {
        return `❌ Failed to cancel: ${error.message}`
      }

      const formattedDate = new Date(appt.appointment_date).toLocaleDateString(
        'en-US',
        {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        },
      )
      const formattedTime = new Date(
        `2000-01-01 ${appt.start_time}`,
      ).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })

      return `✅ Cancelled appointment for ${displayCustomerName(customer)}\n📅 ${formattedDate} at ${formattedTime}`
    }

    case 'lookup_customer': {
      const customerName = String(input.customer_name)

      const customer = await findCustomer(customerName, supabase)

      if (!customer) {
        return `❌ Couldn't find customer "${customerName}"`
      }

      // Get their service address
      const { data: address } = await supabase
        .from('ops_service_addresses')
        .select('street_1, city, state, zip_code')
        .eq('customer_id', customer.id)
        .limit(1)
        .maybeSingle()

      // Count total jobs
      const { count: totalJobs } = await supabase
        .from('ops_appointments')
        .select('*', { count: 'exact', head: true })
        .eq('customer_id', customer.id)
        .eq('status', 'completed')

      // Get last job date
      const { data: lastJob } = await supabase
        .from('ops_appointments')
        .select('appointment_date, completed_at')
        .eq('customer_id', customer.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      let info = `👤 ${displayCustomerName(customer)}\n`
      if (
        customer.business_name &&
        customer.full_name !== customer.business_name
      ) {
        info += `Contact: ${customer.full_name}\n`
      }
      info += `📱 ${customer.phone}\n`
      if (customer.email) info += `📧 ${customer.email}\n`
      if (address) {
        info += `📍 ${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}\n`
      }
      info += `\n📊 Total jobs: ${totalJobs || 0}\n`
      if (lastJob) {
        const lastDate = new Date(
          lastJob.completed_at || lastJob.appointment_date,
        ).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
        info += `📅 Last clean: ${lastDate}\n`
      }
      if (customer.notes) {
        info += `\n📝 Notes: ${customer.notes}`
      }

      return info
    }

    case 'customer_history': {
      const customerName = String(input.customer_name)
      const limit = Number(input.limit) || 5

      const customer = await findCustomer(customerName, supabase)

      if (!customer) {
        return `❌ Couldn't find customer "${customerName}"`
      }

      // Get their job history
      const { data: jobs } = await supabase
        .from('ops_appointments')
        .select('appointment_date, completed_at, quoted_total, status')
        .eq('customer_id', customer.id)
        .order('appointment_date', { ascending: false })
        .limit(limit)

      if (!jobs || jobs.length === 0) {
        return `📭 No job history found for ${displayCustomerName(customer)}`
      }

      let history = `📜 Job History - ${displayCustomerName(customer)}\n\n`
      for (const job of jobs) {
        const date = new Date(job.appointment_date).toLocaleDateString(
          'en-US',
          {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          },
        )
        const statusIcon =
          job.status === 'completed'
            ? '✅'
            : job.status === 'booked'
              ? '📌'
              : '⏸️'
        const amount = job.quoted_total ? ` - $${job.quoted_total}` : ''

        history += `${statusIcon} ${date}${amount}\n`
      }

      return history
    }

    case 'customer_schedule_summary': {
      const customerName = String(input.customer_name)
      const fromDate = input.from_date
        ? String(input.from_date)
        : getTodayMountain()
      const toDate = input.to_date
        ? String(input.to_date)
        : getEndOfYearMountain()
      const includeCancelled = input.include_cancelled === true
      const limit = Math.min(Math.max(Number(input.limit) || 80, 1), 150)

      const customer = await findCustomer(customerName, supabase)

      if (!customer) {
        return JSON.stringify({
          error: `Couldn't find customer "${customerName}"`,
        })
      }

      let query = supabase
        .from('ops_appointments')
        .select(
          `
          id,
          appointment_date,
          start_time,
          end_time,
          status,
          internal_notes,
          quoted_total,
          ops_appointment_line_items (
            name_snapshot,
            notes,
            quantity,
            line_total
          )
        `,
        )
        .eq('customer_id', customer.id)
        .gte('appointment_date', fromDate)
        .lte('appointment_date', toDate)
        .order('appointment_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(limit)

      if (!includeCancelled) {
        query = query.neq('status', 'cancelled')
      }

      const { data: appointments, error } = await query

      if (error) {
        return JSON.stringify({
          error: `Couldn't load schedule: ${error.message}`,
        })
      }

      const jobs = (appointments || []).map((appointment) => {
        const lineItems = (
          Array.isArray(appointment.ops_appointment_line_items)
            ? appointment.ops_appointment_line_items
            : []
        ) as JobDetailLineItem[]

        return {
          id: appointment.id,
          date: appointment.appointment_date,
          start_time: appointment.start_time,
          end_time: appointment.end_time,
          status: appointment.status,
          internal_notes: appointment.internal_notes,
          total: appointment.quoted_total,
          services: lineItems.map((line) => ({
            name: line.name_snapshot,
            quantity: line.quantity,
            notes: line.notes,
            line_total: line.line_total,
          })),
        }
      })

      return JSON.stringify({
        customer: {
          id: customer.id,
          name: displayCustomerName(customer),
          contact_name: customer.full_name,
          phone: customer.phone,
          email: customer.email,
        },
        range: { from_date: fromDate, to_date: toDate },
        count: jobs.length,
        truncated: jobs.length >= limit,
        jobs,
      })
    }

    case 'search_job_details': {
      const customerName = String(input.customer_name)
      const searchText = String(input.query || '').trim()
      const includeFuture = input.include_future === true
      const limit = Number(input.limit) || 5

      const customer = await findCustomer(customerName, supabase)

      if (!customer) {
        return `❌ Couldn't find customer "${customerName}"`
      }

      if (!searchText) {
        return '❌ Tell me what room, building, service, or detail to search for.'
      }

      let query = supabase
        .from('ops_appointments')
        .select(
          `
          id,
          appointment_date,
          start_time,
          completed_at,
          status,
          internal_notes,
          quoted_total,
          ops_appointment_line_items (
            name_snapshot,
            notes,
            quantity,
            line_total
          )
        `,
        )
        .eq('customer_id', customer.id)
        .order('appointment_date', { ascending: false })
        .order('start_time', { ascending: false })
        .limit(100)

      if (!includeFuture) {
        query = query.lte('appointment_date', getTodayMountain())
      }

      const { data: appointments, error } = await query

      if (error) {
        return `❌ Couldn't search job details: ${error.message}`
      }

      const terms = searchText.toLowerCase().split(/\s+/).filter(Boolean)

      const matches = (appointments || [])
        .map((appointment) => {
          const lineItems = (
            Array.isArray(appointment.ops_appointment_line_items)
              ? appointment.ops_appointment_line_items
              : []
          ) as JobDetailLineItem[]

          const searchable = [
            appointment.internal_notes,
            ...lineItems.flatMap((line) => [
              line.name_snapshot,
              line.notes,
              line.quantity,
              line.line_total,
            ]),
          ]
            .filter((value) => value !== null && value !== undefined)
            .join(' ')
            .toLowerCase()

          const isMatch = terms.every((term) => searchable.includes(term))
          return { appointment, lineItems, isMatch }
        })
        .filter((entry) => entry.isMatch)
        .slice(0, limit)

      if (matches.length === 0) {
        const futureNote = includeFuture
          ? ''
          : ' I only checked past/today jobs; ask what is scheduled if you want future booked work too.'
        return `📭 I found ${displayCustomerName(customer)}, but no job details matching "${searchText}".${futureNote}`
      }

      let response = `🔎 ${displayCustomerName(customer)} — "${searchText}"\n\n`
      for (const { appointment, lineItems } of matches) {
        const date = new Date(appointment.appointment_date).toLocaleDateString(
          'en-US',
          {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          },
        )
        const time = new Date(
          `2000-01-01 ${appointment.start_time}`,
        ).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })
        const statusIcon =
          appointment.status === 'completed'
            ? '✅'
            : appointment.status === 'booked'
              ? '📌'
              : '⏸️'
        response += `${statusIcon} ${date} at ${time} — ${appointment.status}\n`

        const matchingLines = lineItems.filter((line) => {
          const lineText = [line.name_snapshot, line.notes]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          return terms.every((term) => lineText.includes(term))
        })
        const linesToShow = matchingLines.length > 0 ? matchingLines : lineItems

        for (const line of linesToShow.slice(0, 3)) {
          const qty = line.quantity ? ` (${line.quantity})` : ''
          response += `• ${line.name_snapshot || 'Service'}${qty}`
          if (line.notes) response += ` — ${line.notes}`
          response += '\n'
        }

        if (appointment.internal_notes) {
          response += `Notes: ${appointment.internal_notes}\n`
        }
        if (appointment.quoted_total) {
          response += `Total: $${appointment.quoted_total}\n`
        }
        response += '\n'
      }

      return response.trim()
    }

    case 'mark_complete': {
      const customerName = String(input.customer_name)
      const targetDate = input.date ? String(input.date) : getTodayMountain()

      const customer = await findCustomer(customerName, supabase)

      if (!customer) {
        return `❌ Couldn't find customer "${customerName}"`
      }

      // Find appointment for that date
      const { data: appointments } = await supabase
        .from('ops_appointments')
        .select('id, appointment_date, start_time, status')
        .eq('customer_id', customer.id)
        .eq('appointment_date', targetDate)
        .limit(1)

      if (!appointments || appointments.length === 0) {
        return `❌ No appointment found for ${displayCustomerName(customer)} on ${targetDate}`
      }

      const appt = appointments[0]

      // Mark as complete
      const { error } = await supabase
        .from('ops_appointments')
        .update({
          status: 'completed',
          completed_at: getMountainTime().toISOString(),
        })
        .eq('id', appt.id)

      if (error) {
        return `❌ Failed to mark complete: ${error.message}`
      }

      return `✅ Marked ${displayCustomerName(customer)}'s job as complete`
    }

    case 'today_summary': {
      const targetDate = input.date ? String(input.date) : getTodayMountain()

      // Get all appointments for the day
      const { data: appointments } = await supabase
        .from('ops_appointments')
        .select(
          'id, start_time, status, quoted_total, customer_id, payment_status',
        )
        .eq('appointment_date', targetDate)
        .order('start_time', { ascending: true })

      if (!appointments || appointments.length === 0) {
        const formattedDate = new Date(targetDate).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })
        return `📅 ${formattedDate}\n\nNo appointments scheduled`
      }

      // Get customer names
      const customerIds = appointments.map((a) => a.customer_id)
      const { data: customers } = await supabase
        .from('ops_customers')
        .select('id, full_name, business_name')
        .in('id', customerIds)

      const customerMap = new Map(
        customers?.map((c) => [c.id, displayCustomerName(c)]),
      )

      const completed = appointments.filter((a) => a.status === 'completed')
      const pending = appointments.filter((a) => a.status !== 'completed')
      const totalRevenue = appointments
        .filter((a) => a.status === 'completed')
        .reduce((sum, a) => sum + (Number(a.quoted_total) || 0), 0)
      const unpaid = appointments.filter(
        (a) => a.status === 'completed' && a.payment_status !== 'paid',
      )

      const formattedDate = new Date(targetDate).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })

      let summary = `📊 Daily Summary - ${formattedDate}\n\n`
      summary += `📋 Total Jobs: ${appointments.length}\n`
      summary += `✅ Completed: ${completed.length}\n`
      summary += `📌 Pending: ${pending.length}\n`
      summary += `💰 Revenue: $${totalRevenue.toFixed(2)}\n`
      if (unpaid.length > 0) {
        summary += `⚠️ Unpaid: ${unpaid.length} job${unpaid.length > 1 ? 's' : ''}\n`
      }

      if (pending.length > 0) {
        summary += `\n📌 Still pending:\n`
        for (const appt of pending) {
          const customerName = customerMap.get(appt.customer_id) || 'Unknown'
          const time = new Date(
            `2000-01-01 ${appt.start_time}`,
          ).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })
          summary += `  ${time} - ${customerName}\n`
        }
      }

      return summary
    }

    case 'add_customer': {
      const fullName = String(input.full_name)
      const phone = String(input.phone)
      const email = input.email ? String(input.email) : null
      const address = input.address ? String(input.address) : null
      const notes = input.notes ? String(input.notes) : null

      // Normalize phone number
      const digits = phone.replace(/\D/g, '')
      const normalizedPhone =
        digits.length === 10 ? `+1${digits}` : `+${digits}`

      // Check if customer already exists
      const { data: existing } = await supabase
        .from('ops_customers')
        .select('id, full_name')
        .eq('phone', normalizedPhone)
        .maybeSingle()

      if (existing) {
        return `❌ Customer already exists: ${existing.full_name}`
      }

      // Insert customer
      const { data: newCustomer, error: customerError } = await supabase
        .from('ops_customers')
        .insert({
          full_name: fullName,
          phone: normalizedPhone,
          email,
          notes,
        })
        .select('id, full_name')
        .single()

      if (customerError) {
        return `❌ Failed to add customer: ${customerError.message}`
      }

      // Add service address if provided
      if (address && newCustomer) {
        await supabase.from('ops_service_addresses').insert({
          customer_id: newCustomer.id,
          street: address,
          city: 'Colorado Springs',
          state: 'CO',
          zip: '',
        })
      }

      return `✅ Added new customer: ${fullName}\n📱 ${normalizedPhone}${email ? `\n📧 ${email}` : ''}${address ? `\n📍 ${address}` : ''}`
    }

    case 'check_availability': {
      let targetDate = String(input.date)
      const startTime = String(input.start_time)
      const durationHours = Number(input.duration_hours) || 1

      // Handle relative dates (Mountain Time)
      if (targetDate.toLowerCase() === 'today') {
        targetDate = getTodayMountain()
      } else if (targetDate.toLowerCase() === 'tomorrow') {
        targetDate = getTomorrowMountain()
      }

      // Calculate end time
      const [hours, minutes] = startTime.split(':').map(Number)
      const endHours = hours + durationHours
      const endTime = `${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`

      // Check for overlapping appointments
      const { data: conflicts } = await supabase
        .from('ops_appointments')
        .select('id, start_time, end_time, customer_id')
        .eq('appointment_date', targetDate)
        .or(`and(start_time.lt.${endTime},end_time.gt.${startTime}:00)`)

      if (!conflicts || conflicts.length === 0) {
        const formattedDate = new Date(targetDate).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
        const formattedTime = new Date(
          `2000-01-01 ${startTime}`,
        ).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })
        return `✅ Available!\n📅 ${formattedDate} at ${formattedTime}\n⏱️ ${durationHours}h slot is open`
      }

      // Get customer names for conflicts
      const customerIds = conflicts.map((c) => c.customer_id)
      const { data: customers } = await supabase
        .from('ops_customers')
        .select('id, full_name, business_name')
        .in('id', customerIds)

      const customerMap = new Map(
        customers?.map((c) => [c.id, displayCustomerName(c)]),
      )

      let conflictInfo = `❌ Time slot conflicts:\n\n`
      for (const conflict of conflicts) {
        const customerName = customerMap.get(conflict.customer_id) || 'Unknown'
        const time = new Date(
          `2000-01-01 ${conflict.start_time}`,
        ).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })
        conflictInfo += `${time} - ${customerName}\n`
      }

      return conflictInfo
    }

    case 'payment_status': {
      const customerName = String(input.customer_name)
      const markPaid = input.mark_paid === true

      const customer = await findCustomer(customerName, supabase)

      if (!customer) {
        return `❌ Couldn't find customer "${customerName}"`
      }

      // Get most recent completed job
      const { data: jobs } = await supabase
        .from('ops_appointments')
        .select('id, appointment_date, quoted_total, payment_status')
        .eq('customer_id', customer.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)

      if (!jobs || jobs.length === 0) {
        return `❌ No completed jobs found for ${displayCustomerName(customer)}`
      }

      const job = jobs[0]

      if (markPaid) {
        const { error } = await supabase
          .from('ops_appointments')
          .update({ payment_status: 'paid' })
          .eq('id', job.id)

        if (error) {
          return `❌ Failed to update payment: ${error.message}`
        }

        return `✅ Marked as paid: ${displayCustomerName(customer)}\n💰 $${job.quoted_total || '0.00'}`
      }

      const isPaid = job.payment_status === 'paid'
      const status = isPaid ? '✅ Paid' : '⏳ Unpaid'
      const date = new Date(job.appointment_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })

      return `${status}\n👤 ${displayCustomerName(customer)}\n📅 ${date}\n💰 $${job.quoted_total || '0.00'}`
    }

    case 'add_job_note': {
      const customerName = String(input.customer_name)
      const note = String(input.note)
      const targetDate = input.date ? String(input.date) : null

      const customer = await findCustomer(customerName, supabase)

      if (!customer) {
        return `❌ Couldn't find customer "${customerName}"`
      }

      // Find appointment
      let query = supabase
        .from('ops_appointments')
        .select('id, appointment_date, internal_notes')
        .eq('customer_id', customer.id)

      if (targetDate) {
        query = query.eq('appointment_date', targetDate)
      } else {
        query = query.gte(
          'appointment_date',
          new Date().toISOString().split('T')[0],
        )
      }

      const { data: appointments } = await query
        .order('appointment_date', { ascending: true })
        .limit(1)

      if (!appointments || appointments.length === 0) {
        return `❌ No appointment found for ${displayCustomerName(customer)}`
      }

      const appt = appointments[0]

      // Append note to existing notes
      const existingNotes = appt.internal_notes || ''
      const updatedNotes = existingNotes ? `${existingNotes}\n${note}` : note

      const { error } = await supabase
        .from('ops_appointments')
        .update({ internal_notes: updatedNotes })
        .eq('id', appt.id)

      if (error) {
        return `❌ Failed to add note: ${error.message}`
      }

      return `✅ Added note to ${displayCustomerName(customer)}'s job\n📝 "${note}"`
    }

    default:
      return `❌ Unknown tool: ${toolName}`
  }
}

async function approvePendingCommandAction(
  actionId: string,
  userId: number,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const { data, error } = await supabase
    .from('harry_command_pending_actions')
    .select(
      'id, thread_id, action_type, action_payload, payload_hash, target_label, preview, status, expires_at, telegram_user_id',
    )
    .eq('id', actionId)
    .maybeSingle()

  const action = data as CommandActionRow | null
  if (error || !action) {
    await sendToCharles(
      '❌ Pending action not found. Ask Harry to build it again.',
    )
    return
  }

  if (action.status !== 'pending') {
    await sendToCharles(`❌ That action is already ${action.status}.`)
    return
  }

  if (Date.parse(String(action.expires_at || '')) < Date.now()) {
    await supabase
      .from('harry_command_pending_actions')
      .update({
        status: 'expired',
        error_message: 'Approval expired before execution',
      })
      .eq('id', action.id)
    await sendToCharles(
      '❌ That approval expired. Ask Harry to build it again.',
    )
    return
  }

  if (hashPayload(action.action_payload) !== action.payload_hash) {
    await supabase
      .from('harry_command_pending_actions')
      .update({
        status: 'failed',
        error_message: 'Payload hash mismatch',
      })
      .eq('id', action.id)
    await sendToCharles('❌ Integrity check failed. I cancelled that action.')
    return
  }

  if (action.action_payload.kind !== 'send_customer_sms') {
    await sendToCharles(`❌ Unsupported action: ${action.action_type}`)
    return
  }

  try {
    const payload = action.action_payload
    const sendResult = await sendCustomerSMSWithResult(
      payload.phoneNumber,
      payload.message,
    )

    if (payload.conversationId) {
      const { data: conversation } = await supabase
        .from('conversations')
        .select('messages')
        .eq('id', payload.conversationId)
        .maybeSingle()

      const messages =
        (conversation?.messages as Array<{
          role: string
          content: string
          timestamp: string
        }>) || []

      messages.push({
        role: 'assistant',
        content: payload.message,
        timestamp: new Date().toISOString(),
      })

      await supabase
        .from('conversations')
        .update({
          messages,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.conversationId)
    }

    await supabase
      .from('harry_command_pending_actions')
      .update({
        status: 'executed',
        approved_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', action.id)

    await writeCommandAudit(supabase, {
      threadId: action.thread_id,
      pendingActionId: action.id,
      actionType: action.action_type,
      status: 'executed',
      targetLabel: payload.targetLabel,
      payload: payload as unknown as Record<string, unknown>,
      result: sendResult,
      telegramUserId: userId,
    })

    await logCommandMessage(supabase, {
      threadId: action.thread_id,
      role: 'assistant',
      content: `Sent SMS to ${payload.targetLabel} (${sendResult.to}). Twilio SID: ${sendResult.sid}`,
      metadata: { pending_action_id: action.id, twilio_sid: sendResult.sid },
    })

    await sendToCharles(
      `✅ Sent SMS to ${payload.targetLabel} (${sendResult.to}). Twilio SID: ${sendResult.sid}`,
    )
  } catch (sendError) {
    const errorMessage =
      sendError instanceof Error ? sendError.message : String(sendError)
    await supabase
      .from('harry_command_pending_actions')
      .update({
        status: 'failed',
        error_message: errorMessage,
      })
      .eq('id', action.id)
    await writeCommandAudit(supabase, {
      threadId: action.thread_id,
      pendingActionId: action.id,
      actionType: action.action_type,
      status: 'failed',
      targetLabel: action.target_label,
      payload: action.action_payload as unknown as Record<string, unknown>,
      result: { error: errorMessage },
      telegramUserId: userId,
    })
    await sendToCharles(`❌ SMS failed: ${errorMessage}`)
  }
}

async function cancelPendingCommandAction(
  actionId: string,
  userId: number,
  supabase: ReturnType<typeof createAdminClient>,
  thread: CommandThread | null,
): Promise<void> {
  const { data } = await supabase
    .from('harry_command_pending_actions')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', actionId)
    .eq('status', 'pending')
    .select('id, thread_id, action_type, action_payload, target_label')
    .maybeSingle()

  const action = data as {
    id: string
    thread_id: string
    action_type: string
    action_payload: Record<string, unknown>
    target_label: string | null
  } | null

  await writeCommandAudit(supabase, {
    threadId: action?.thread_id || thread?.id || null,
    pendingActionId: actionId,
    actionType: action?.action_type || 'unknown',
    status: 'cancelled',
    targetLabel: action?.target_label || null,
    payload: action?.action_payload || {},
    telegramUserId: userId,
  })
  await sendToCharles('✅ Action cancelled.')
}

/**
 * Handle button clicks
 */
async function handleButtonClick(
  data: string,
  userId: number,
  thread: CommandThread | null,
): Promise<void> {
  const supabase = createAdminClient()

  if (data.startsWith('approveaction_')) {
    const actionId = data.replace('approveaction_', '')
    await approvePendingCommandAction(actionId, userId, supabase)
    return
  }

  if (data.startsWith('cancelaction_')) {
    const actionId = data.replace('cancelaction_', '')
    await cancelPendingCommandAction(actionId, userId, supabase, thread)
    return
  }

  if (data.startsWith('selectcust_')) {
    if (!thread) {
      await sendToCharles('❌ Missing command thread. Ask Harry again.')
      return
    }
    const customerId = data.replace('selectcust_', '')
    const artifact = await getLatestArtifact(supabase, thread.id)
    const { data: customer } = await supabase
      .from('ops_customers')
      .select(CUSTOMER_SELECT)
      .eq('id', customerId)
      .maybeSingle()

    if (!artifact || !customer) {
      await sendToCharles(
        '❌ I lost the report or customer selection. Ask Harry to build it again.',
      )
      return
    }

    await createArtifactSmsApproval(
      thread,
      artifact,
      customer as HarryCustomer,
      userId,
      supabase,
    )
    return
  }

  if (data.startsWith('senddraft_')) {
    const draftId = data.replace('senddraft_', '')
    const { data: draft, error } = await supabase
      .from('harry_command_sms_drafts')
      .select(
        'id, target_label, phone_number, message, conversation_id, status, expires_at',
      )
      .eq('id', draftId)
      .maybeSingle()

    if (error || !draft) {
      await sendToCharles(
        '❌ SMS draft not found. Ask Harry to draft it again.',
      )
      return
    }

    if (draft.status !== 'pending') {
      await sendToCharles(`❌ SMS draft is already ${draft.status}.`)
      return
    }

    if (Date.parse(String(draft.expires_at || '')) < Date.now()) {
      await supabase
        .from('harry_command_sms_drafts')
        .update({
          status: 'expired',
          error_message: 'Approval expired before send',
        })
        .eq('id', draft.id)
      await sendToCharles('❌ SMS draft expired. Ask Harry to draft it again.')
      return
    }

    try {
      const sendResult = await sendCustomerSMSWithResult(
        draft.phone_number,
        draft.message,
      )

      if (draft.conversation_id) {
        const { data: conversation } = await supabase
          .from('conversations')
          .select('messages')
          .eq('id', draft.conversation_id)
          .maybeSingle()

        const messages =
          (conversation?.messages as Array<{
            role: string
            content: string
            timestamp: string
          }>) || []

        messages.push({
          role: 'assistant',
          content: draft.message,
          timestamp: new Date().toISOString(),
        })

        await supabase
          .from('conversations')
          .update({
            messages,
            updated_at: new Date().toISOString(),
          })
          .eq('id', draft.conversation_id)
      }

      await supabase
        .from('harry_command_sms_drafts')
        .update({
          status: 'sent',
          approved_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', draft.id)

      await sendToCharles(
        `✅ Sent SMS to ${draft.target_label} (${draft.phone_number}). Twilio SID: ${sendResult.sid}\n\n"${draft.message}"`,
      )
    } catch (sendError) {
      const errorMessage =
        sendError instanceof Error ? sendError.message : String(sendError)
      await supabase
        .from('harry_command_sms_drafts')
        .update({
          status: 'failed',
          error_message: errorMessage,
        })
        .eq('id', draft.id)
      await sendToCharles(`❌ Failed to send SMS: ${errorMessage}`)
    }
    return
  }

  if (data.startsWith('canceldraft_')) {
    const draftId = data.replace('canceldraft_', '')
    await supabase
      .from('harry_command_sms_drafts')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', draftId)
      .eq('status', 'pending')
    await sendToCharles('✅ SMS draft cancelled.')
    return
  }

  // View conversation button
  if (data.startsWith('view_')) {
    const conversationId = data.replace('view_', '')

    const { data: conv } = await supabase
      .from('conversations')
      .select('phone_number, messages, ai_enabled, source')
      .eq('id', conversationId)
      .single()

    if (!conv) {
      await sendToCharles('❌ Conversation not found')
      return
    }

    const messages =
      (conv.messages as Array<{
        role: string
        content: string
        timestamp: string
      }>) || []

    const sourceLabel =
      conv.source === 'inbound'
        ? '📞 MAIN'
        : conv.source === 'Google LSA' || conv.source === 'lsa'
          ? '🔵 LSA'
          : '💬 OTHER'

    let thread = `${sourceLabel} | 📱 ${conv.phone_number}\n🤖 Harry: ${conv.ai_enabled ? 'ON' : 'OFF'}\n\n`

    const recentMessages = messages.slice(-10)
    for (const msg of recentMessages) {
      const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
      const role = msg.role === 'user' ? '👤' : '🤖'
      const preview =
        msg.content.length > 200
          ? msg.content.substring(0, 200) + '...'
          : msg.content
      thread += `${time} ${role}: ${preview}\n\n`
    }

    await sendToCharles(thread)
    return
  }

  // Reply button
  if (data.startsWith('reply_')) {
    await sendToCharles(
      '💬 Just tell me what you want to say, like:\n"Tell them I\'m on my way"',
    )
    return
  }

  // Take over button
  if (data.startsWith('takeover_')) {
    const conversationId = data.replace('takeover_', '')

    await supabase
      .from('conversations')
      .update({ ai_enabled: false })
      .eq('id', conversationId)

    await sendToCharles(
      '✅ You took over - Harry is now disabled for this conversation',
    )
    return
  }
}

/**
 * Find a conversation by name or phone number
 */
async function findConversation(
  target: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{
  id: string
  phone_number: string
  messages: unknown
} | null> {
  // Try to find by phone number (extract digits)
  const digits = target.replace(/\D/g, '')
  if (digits.length >= 10) {
    const phone = digits.length === 10 ? `+1${digits}` : `+${digits}`
    const phoneVariants = opsPhoneLookupVariants(phone)
    const { data } = await supabase
      .from('conversations')
      .select('id, phone_number, messages')
      .in('phone_number', phoneVariants)
      .maybeSingle()

    if (data) return data
  }

  // Try to find by customer or business name
  const customer = await findCustomer(target, supabase)

  if (customer?.phone) {
    const phoneVariants = opsPhoneLookupVariants(customer.phone)
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, phone_number, messages')
      .in('phone_number', phoneVariants)
      .maybeSingle()

    if (conv) return conv
  }

  return null
}
