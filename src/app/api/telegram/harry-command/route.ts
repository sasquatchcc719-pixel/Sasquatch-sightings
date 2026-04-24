/**
 * Telegram webhook for Harry Command bot
 * Receives commands from Charles and executes them
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendCustomerSMS } from '@/lib/twilio'
import { confirmAction, sendError } from '@/lib/harry-command-bot'

type TelegramUpdate = {
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

export async function POST(request: NextRequest) {
  try {
    const update = (await request.json()) as TelegramUpdate

    // Handle text commands
    if (update.message?.text) {
      await handleTextCommand(update.message.text, update.message.chat.id)
    }

    // Handle button clicks
    if (update.callback_query) {
      await handleButtonClick(
        update.callback_query.data,
        update.callback_query.from.id,
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Harry Command webhook error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * Handle text commands from Charles
 */
async function handleTextCommand(text: string, chatId: number): Promise<void> {
  const supabase = createAdminClient()

  // Command: "Tell [name/phone] [message]"
  const tellMatch = text.match(/^tell\s+(.+?)\s+(.+)$/i)
  if (tellMatch) {
    const [, target, message] = tellMatch
    await handleTellCommand(target, message, supabase)
    return
  }

  // Command: "Show [name/phone]" or "View [name/phone]"
  const showMatch = text.match(/^(show|view)\s+(.+)$/i)
  if (showMatch) {
    const [, , target] = showMatch
    await handleShowCommand(target, supabase)
    return
  }

  // Command: "Take over [name/phone]"
  const takeoverMatch = text.match(/^take\s+over\s+(.+)$/i)
  if (takeoverMatch) {
    const [, target] = takeoverMatch
    await handleTakeoverCommand(target, supabase)
    return
  }

  // Command: "Enable Harry for [name/phone]"
  const enableMatch = text.match(/^enable\s+harry\s+for\s+(.+)$/i)
  if (enableMatch) {
    const [, target] = enableMatch
    await handleEnableHarryCommand(target, supabase)
    return
  }

  // Unknown command - show help
  await sendError(
    `Unknown command. Try:\n• "Tell Ann I'm on my way"\n• "Show Ann"\n• "Take over Ann"\n• "Enable Harry for Ann"`,
  )
}

/**
 * Handle button clicks
 */
async function handleButtonClick(data: string, userId: number): Promise<void> {
  const supabase = createAdminClient()

  // View conversation button
  if (data.startsWith('view_')) {
    const conversationId = data.replace('view_', '')
    await showConversation(conversationId, supabase)
    return
  }

  // Reply button
  if (data.startsWith('reply_')) {
    const conversationId = data.replace('reply_', '')
    await sendError('Reply via command: "Tell [name] [your message]"')
    return
  }

  // Take over button
  if (data.startsWith('takeover_')) {
    const conversationId = data.replace('takeover_', '')
    await takeoverConversation(conversationId, supabase)
    return
  }
}

/**
 * Execute "Tell [target] [message]" command
 */
async function handleTellCommand(
  target: string,
  message: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<void> {
  // Find conversation by name or phone
  const conversation = await findConversation(target, supabase)
  if (!conversation) {
    await sendError(`Couldn't find conversation for "${target}"`)
    return
  }

  // Get current messages
  const messages =
    (conversation.messages as Array<{
      role: string
      content: string
      timestamp: string
      twilio_sid?: string
    }>) || []

  // Add Charles's message
  messages.push({
    role: 'assistant',
    content: message,
    timestamp: new Date().toISOString(),
  })

  // Send via Twilio
  await sendCustomerSMS(conversation.phone_number, message)

  // Update conversation
  await supabase
    .from('conversations')
    .update({
      messages,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  await confirmAction(`Message sent to ${target}`)
}

/**
 * Execute "Show [target]" command
 */
async function handleShowCommand(
  target: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const conversation = await findConversation(target, supabase)
  if (!conversation) {
    await sendError(`Couldn't find conversation for "${target}"`)
    return
  }

  await showConversation(conversation.id, supabase)
}

/**
 * Execute "Take over [target]" command
 */
async function handleTakeoverCommand(
  target: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const conversation = await findConversation(target, supabase)
  if (!conversation) {
    await sendError(`Couldn't find conversation for "${target}"`)
    return
  }

  await takeoverConversation(conversation.id, supabase)
}

/**
 * Execute "Enable Harry for [target]" command
 */
async function handleEnableHarryCommand(
  target: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const conversation = await findConversation(target, supabase)
  if (!conversation) {
    await sendError(`Couldn't find conversation for "${target}"`)
    return
  }

  await supabase
    .from('conversations')
    .update({ ai_enabled: true })
    .eq('id', conversation.id)

  await confirmAction(`Harry enabled for ${target}`)
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
    const { data } = await supabase
      .from('conversations')
      .select('id, phone_number, messages')
      .eq('phone_number', phone)
      .maybeSingle()

    if (data) return data
  }

  // Try to find by customer name
  const { data: customer } = await supabase
    .from('ops_customers')
    .select('id, phone')
    .or(`full_name.ilike.%${target}%,first_name.ilike.%${target}%`)
    .limit(1)
    .maybeSingle()

  if (customer) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('id, phone_number, messages')
      .eq('phone_number', customer.phone)
      .maybeSingle()

    if (conv) return conv
  }

  return null
}

/**
 * Show full conversation thread
 */
async function showConversation(
  conversationId: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const { data: conv } = await supabase
    .from('conversations')
    .select('phone_number, messages, ai_enabled, source')
    .eq('id', conversationId)
    .single()

  if (!conv) {
    await sendError('Conversation not found')
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

  const recentMessages = messages.slice(-10) // Last 10 messages
  for (const msg of recentMessages) {
    const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
    const role = msg.role === 'user' ? '👤 Customer' : '🤖 Harry'
    const preview =
      msg.content.length > 200
        ? msg.content.substring(0, 200) + '...'
        : msg.content
    thread += `${time} ${role}:\n${preview}\n\n`
  }

  await confirmAction(thread)
}

/**
 * Disable Harry and take over a conversation
 */
async function takeoverConversation(
  conversationId: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<void> {
  await supabase
    .from('conversations')
    .update({ ai_enabled: false })
    .eq('id', conversationId)

  await confirmAction(
    'You took over - Harry is now disabled for this conversation',
  )
}
