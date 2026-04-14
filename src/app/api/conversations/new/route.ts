import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
import { sendCustomerSMS } from '@/lib/twilio'

function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

export async function POST(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !role || !['admin', 'owner', 'dispatcher'].includes(role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { phoneNumber, message } = await request.json()

    if (!phoneNumber || !message) {
      return NextResponse.json(
        { error: 'Missing phoneNumber or message' },
        { status: 400 },
      )
    }

    const normalizedPhone = toE164(phoneNumber)
    const supabase = createAdminClient()

    // Check for existing conversation with this phone number
    const { data: existing } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone_number', normalizedPhone)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      // Append to existing conversation
      const messages = (existing.messages as any[]) || []
      messages.push({
        role: 'assistant',
        content: message,
        timestamp: new Date().toISOString(),
        sent_by: 'admin',
      })

      await sendCustomerSMS(
        normalizedPhone,
        message,
        existing.lead_id,
        'admin_outbound',
      )

      await supabase
        .from('conversations')
        .update({
          messages,
          status: existing.status === 'completed' ? 'active' : existing.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      return NextResponse.json({
        success: true,
        conversationId: existing.id,
        isNew: false,
      })
    }

    // Create new conversation
    await sendCustomerSMS(normalizedPhone, message, undefined, 'admin_outbound')

    const newMessages = [
      {
        role: 'assistant',
        content: message,
        timestamp: new Date().toISOString(),
        sent_by: 'admin',
      },
    ]

    const { data: newConvo, error: insertError } = await supabase
      .from('conversations')
      .insert({
        phone_number: normalizedPhone,
        source: 'admin_outbound',
        messages: newMessages,
        ai_enabled: true,
        status: 'active',
      })
      .select('id')
      .single()

    if (insertError) throw insertError

    return NextResponse.json({
      success: true,
      conversationId: newConvo.id,
      isNew: true,
    })
  } catch (error) {
    console.error('[conversations/new] Error:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 },
    )
  }
}
