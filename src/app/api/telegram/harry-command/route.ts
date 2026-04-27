/**
 * Telegram webhook for Harry Command bot
 * AI-powered conversational interface for Charles to manage customer conversations
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createAdminClient } from '@/supabase/server'
import { sendCustomerSMS } from '@/lib/twilio'
import { sendToCharles } from '@/lib/harry-command-bot'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are Harry Command Bot, Charles's personal AI assistant for managing his carpet cleaning business.

Charles owns Sasquatch Carpet Cleaning in Colorado Springs, CO. You help him manage customer conversations, send messages, and control Harry (the AI that handles customer SMS).

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
- Mark jobs as complete
- Add new customers to the system
- Check schedule availability
- View/update payment status
- Add notes to jobs
- Get daily business summary

Be conversational, helpful, and concise. Charles is texting you from his phone while working, so keep responses brief but informative.`,
        },
        { role: 'user', content: text },
      ],
      tools: [
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
      ],
    })

    // Process the response
    let finalResponse = ''
    const choice = response.choices[0]

    if (choice.message.content) {
      finalResponse += choice.message.content
    }

    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type === 'function') {
          const args = JSON.parse(toolCall.function.arguments)
          const toolResult = await executeToolCall(
            toolCall.function.name,
            args,
            supabase,
          )
          finalResponse += '\n\n' + toolResult
        }
      }
    }

    if (finalResponse) {
      await sendToCharles(finalResponse.trim())
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

    case 'add_appointment': {
      const customerName = String(input.customer_name)
      const date = String(input.date)
      const startTime = String(input.start_time)
      const durationHours = Number(input.duration_hours) || 1
      const notes = input.notes ? String(input.notes) : null

      // Find customer by name
      const { data: customer } = await supabase
        .from('ops_customers')
        .select('id, full_name, phone')
        .or(
          `full_name.ilike.%${customerName}%,first_name.ilike.%${customerName}%,last_name.ilike.%${customerName}%`,
        )
        .limit(1)
        .maybeSingle()

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

      // Send booking notification (fire and forget)
      fetch(
        `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/appointment-booked`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'INSERT',
            record: { id: newAppt.id },
          }),
        },
      ).catch((err) =>
        console.error(
          '[add_appointment] Failed to send booking notification:',
          err,
        ),
      )

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

      return `✅ Added ${customer.full_name} to schedule\n📅 ${formattedDate} at ${formattedTime}\n⏱️ ${durationHours}h${notes ? `\n📝 ${notes}` : ''}`
    }

    case 'view_schedule': {
      let targetDate = String(input.date)

      // Handle relative dates
      const today = new Date()
      if (targetDate.toLowerCase() === 'today') {
        targetDate = today.toISOString().split('T')[0]
      } else if (targetDate.toLowerCase() === 'tomorrow') {
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)
        targetDate = tomorrow.toISOString().split('T')[0]
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
        .select('id, full_name')
        .in('id', customerIds)

      const customerMap = new Map(customers?.map((c) => [c.id, c.full_name]))

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

      // Find customer
      const { data: customer } = await supabase
        .from('ops_customers')
        .select('id, full_name')
        .or(
          `full_name.ilike.%${customerName}%,first_name.ilike.%${customerName}%,last_name.ilike.%${customerName}%`,
        )
        .limit(1)
        .maybeSingle()

      if (!customer) {
        return `❌ Couldn't find customer "${customerName}"`
      }

      // Find their most recent upcoming appointment
      const { data: appointments } = await supabase
        .from('ops_appointments')
        .select('id, appointment_date, start_time, status')
        .eq('customer_id', customer.id)
        .gte('appointment_date', new Date().toISOString().split('T')[0])
        .order('appointment_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(1)

      if (!appointments || appointments.length === 0) {
        return `❌ No upcoming appointments found for ${customer.full_name}`
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

      let response = `✅ Updated appointment for ${customer.full_name}\n`
      if (newDate) response += `📅 New date: ${newDate}\n`
      if (newStartTime) response += `⏰ New time: ${newStartTime}\n`
      if (newNotes) response += `📝 Notes: ${newNotes}\n`

      return response.trim()
    }

    case 'cancel_appointment': {
      const customerName = String(input.customer_name)
      const targetDate = input.date ? String(input.date) : null

      // Find customer
      const { data: customer } = await supabase
        .from('ops_customers')
        .select('id, full_name')
        .or(
          `full_name.ilike.%${customerName}%,first_name.ilike.%${customerName}%,last_name.ilike.%${customerName}%`,
        )
        .limit(1)
        .maybeSingle()

      if (!customer) {
        return `❌ Couldn't find customer "${customerName}"`
      }

      // Find appointment
      let query = supabase
        .from('ops_appointments')
        .select('id, appointment_date, start_time, status')
        .eq('customer_id', customer.id)
        .gte('appointment_date', new Date().toISOString().split('T')[0])

      if (targetDate) {
        query = query.eq('appointment_date', targetDate)
      }

      const { data: appointments } = await query
        .order('appointment_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(1)

      if (!appointments || appointments.length === 0) {
        return `❌ No upcoming appointments found for ${customer.full_name}`
      }

      const appt = appointments[0]

      // Delete the appointment
      const { error } = await supabase
        .from('ops_appointments')
        .delete()
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

      return `✅ Cancelled appointment for ${customer.full_name}\n📅 ${formattedDate} at ${formattedTime}`
    }

    case 'lookup_customer': {
      const customerName = String(input.customer_name)

      // Find customer
      const { data: customer } = await supabase
        .from('ops_customers')
        .select('id, full_name, phone, email, notes, created_at')
        .or(
          `full_name.ilike.%${customerName}%,first_name.ilike.%${customerName}%,last_name.ilike.%${customerName}%,phone.ilike.%${customerName}%`,
        )
        .limit(1)
        .maybeSingle()

      if (!customer) {
        return `❌ Couldn't find customer "${customerName}"`
      }

      // Get their service address
      const { data: address } = await supabase
        .from('ops_service_addresses')
        .select('street, city, state, zip')
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

      let info = `👤 ${customer.full_name}\n`
      info += `📱 ${customer.phone}\n`
      if (customer.email) info += `📧 ${customer.email}\n`
      if (address) {
        info += `📍 ${address.street}, ${address.city}, ${address.state} ${address.zip}\n`
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

      // Find customer
      const { data: customer } = await supabase
        .from('ops_customers')
        .select('id, full_name')
        .or(
          `full_name.ilike.%${customerName}%,first_name.ilike.%${customerName}%,last_name.ilike.%${customerName}%`,
        )
        .limit(1)
        .maybeSingle()

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
        return `📭 No job history found for ${customer.full_name}`
      }

      let history = `📜 Job History - ${customer.full_name}\n\n`
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

    case 'mark_complete': {
      const customerName = String(input.customer_name)
      const targetDate = input.date
        ? String(input.date)
        : new Date().toISOString().split('T')[0]

      // Find customer
      const { data: customer } = await supabase
        .from('ops_customers')
        .select('id, full_name')
        .or(
          `full_name.ilike.%${customerName}%,first_name.ilike.%${customerName}%,last_name.ilike.%${customerName}%`,
        )
        .limit(1)
        .maybeSingle()

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
        return `❌ No appointment found for ${customer.full_name} on ${targetDate}`
      }

      const appt = appointments[0]

      // Mark as complete
      const { error } = await supabase
        .from('ops_appointments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', appt.id)

      if (error) {
        return `❌ Failed to mark complete: ${error.message}`
      }

      return `✅ Marked ${customer.full_name}'s job as complete`
    }

    case 'today_summary': {
      const targetDate = input.date
        ? String(input.date)
        : new Date().toISOString().split('T')[0]

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
        .select('id, full_name')
        .in('id', customerIds)

      const customerMap = new Map(customers?.map((c) => [c.id, c.full_name]))

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

      // Handle relative dates
      const today = new Date()
      if (targetDate.toLowerCase() === 'today') {
        targetDate = today.toISOString().split('T')[0]
      } else if (targetDate.toLowerCase() === 'tomorrow') {
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)
        targetDate = tomorrow.toISOString().split('T')[0]
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
        .select('id, full_name')
        .in('id', customerIds)

      const customerMap = new Map(customers?.map((c) => [c.id, c.full_name]))

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

      // Find customer
      const { data: customer } = await supabase
        .from('ops_customers')
        .select('id, full_name')
        .or(
          `full_name.ilike.%${customerName}%,first_name.ilike.%${customerName}%,last_name.ilike.%${customerName}%`,
        )
        .limit(1)
        .maybeSingle()

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
        return `❌ No completed jobs found for ${customer.full_name}`
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

        return `✅ Marked as paid: ${customer.full_name}\n💰 $${job.quoted_total || '0.00'}`
      }

      const isPaid = job.payment_status === 'paid'
      const status = isPaid ? '✅ Paid' : '⏳ Unpaid'
      const date = new Date(job.appointment_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })

      return `${status}\n👤 ${customer.full_name}\n📅 ${date}\n💰 $${job.quoted_total || '0.00'}`
    }

    case 'add_job_note': {
      const customerName = String(input.customer_name)
      const note = String(input.note)
      const targetDate = input.date ? String(input.date) : null

      // Find customer
      const { data: customer } = await supabase
        .from('ops_customers')
        .select('id, full_name')
        .or(
          `full_name.ilike.%${customerName}%,first_name.ilike.%${customerName}%,last_name.ilike.%${customerName}%`,
        )
        .limit(1)
        .maybeSingle()

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
        return `❌ No appointment found for ${customer.full_name}`
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

      return `✅ Added note to ${customer.full_name}'s job\n📝 "${note}"`
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
