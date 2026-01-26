/**
 * Send SMS Reply from Admin Portal
 * Allows admins to respond to customer SMS directly from the web interface
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendCustomerSMS } from '@/lib/twilio'

export async function POST(request: NextRequest) {
  try {
    const { conversationId, message } = await request.json()

    if (!conversationId || !message) {
      return NextResponse.json(
        { error: 'Missing conversationId or message' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Fetch conversation
    const { data: conversation, error: fetchError } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single()

    if (fetchError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    // Send SMS via Twilio
    await sendCustomerSMS(
      conversation.phone_number,
      message,
      conversation.lead_id,
      'admin_reply'
    )

    // Add message to conversation history
    const messages = (conversation.messages as any[]) || []
    messages.push({
      role: 'assistant',
      content: message,
      timestamp: new Date().toISOString(),
      sent_by: 'admin', // Tag it as admin-sent
    })

    // Update conversation
    await supabase
      .from('conversations')
      .update({
        messages,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Send reply error:', error)
    return NextResponse.json(
      { error: 'Failed to send reply' },
      { status: 500 }
    )
  }
}
