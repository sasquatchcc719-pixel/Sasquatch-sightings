/**
 * Telegram webhook for Harry Command bot
 * AI-powered conversational interface for Charles to manage customer conversations
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/supabase/server'
import { sendCustomerSMS } from '@/lib/twilio'
import { sendToCharles } from '@/lib/harry-command-bot'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

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
 * Handle text messages from Charles using AI
 */
async function handleTextCommand(text: string, chatId: number): Promise<void> {
  const supabase = createAdminClient()

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      system: `You are Harry Command Bot, Charles's personal AI assistant for managing his carpet cleaning business.

Charles owns Sasquatch Carpet Cleaning in Colorado Springs, CO. You help him manage customer conversations, send messages, and control Harry (the AI that handles customer SMS).

Your capabilities:
- Send SMS messages to customers
- View conversation threads
- Enable/disable Harry for specific conversations
- List recent active conversations
- Answer questions about customer interactions

Be conversational, helpful, and concise. Charles is texting you from his phone while working, so keep responses brief but informative.`,
      messages: [{ role: 'user', content: text }],
      tools: [
        {
          name: 'send_sms',
          description:
            'Send an SMS message to a customer. Use this when Charles wants to text someone.',
          input_schema: {
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
        {
          name: 'view_conversation',
          description:
            'View the full conversation thread with a customer. Shows recent messages and Harry status.',
          input_schema: {
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
        {
          name: 'take_over_conversation',
          description:
            'Disable Harry for a conversation so Charles can handle it manually.',
          input_schema: {
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
        {
          name: 'enable_harry',
          description:
            'Re-enable Harry to handle a conversation automatically.',
          input_schema: {
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
        {
          name: 'list_recent_conversations',
          description:
            'List recent active customer conversations with their status.',
          input_schema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Number of conversations to show (default 10)',
              },
            },
          },
        },
      ],
    })

    // Process the response
    let finalResponse = ''

    for (const block of response.content) {
      if (block.type === 'text') {
        finalResponse += block.text
      } else if (block.type === 'tool_use') {
        const toolResult = await executeToolCall(
          block.name,
          block.input as Record<string, unknown>,
          supabase,
        )
        finalResponse += '\n\n' + toolResult
      }
    }

    if (finalResponse) {
      await sendToCharles(finalResponse.trim())
    }
  } catch (error) {
    console.error('AI processing error:', error)
    await sendToCharles(
      '❌ Sorry, I had trouble processing that. Can you try again?',
    )
  }
}

/**
 * Execute a tool call from Claude
 */
async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string> {
  switch (toolName) {
    case 'send_sms': {
      const target = String(input.target)
      const message = String(input.message)
      const conversation = await findConversation(target, supabase)

      if (!conversation) {
        return `❌ Couldn't find conversation for "${target}"`
      }

      // Get current messages
      const messages =
        (conversation.messages as Array<{
          role: string
          content: string
          timestamp: string
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

      return `✅ Sent to ${conversation.phone_number}: "${message}"`
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

    default:
      return `❌ Unknown tool: ${toolName}`
  }
}

/**
 * Handle button clicks
 */
async function handleButtonClick(data: string, userId: number): Promise<void> {
  const supabase = createAdminClient()

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
