import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendOneSignalNotification } from '@/lib/onesignal'
import { sendRingCentralSMS } from '@/lib/ringcentral'

// Normalize phone number to consistent format
function normalizePhone(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '')
  // If 10 digits, assume US and add +1
  if (digits.length === 10) {
    return `+1${digits}`
  }
  // If 11 digits starting with 1, add +
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }
  // Otherwise return as-is with + prefix
  return digits.startsWith('+') ? phone : `+${digits}`
}

// Format phone for display
function formatPhoneDisplay(phone: string): string {
  const normalized = normalizePhone(phone)
  const match = normalized.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  if (match) {
    return `(${match[1]}) ${match[2]}-${match[3]}`
  }
  return phone
}

/**
 * Detect if this is a RingCentral webhook for missed calls
 */
function isRingCentralWebhook(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const obj = body as Record<string, unknown>
  return 'event' in obj && 'body' in obj && 'telephonyStatus' in (obj.body as Record<string, unknown>)
}

/**
 * Parse RingCentral webhook to extract missed call info
 */
function parseRingCentralMissedCall(body: unknown): { phone: string; name?: string } | null {
  if (typeof body !== 'object' || body === null) return null
  
  const payload = body as Record<string, unknown>
  const webhookBody = payload.body as Record<string, unknown>
  
  // Check if telephonyStatus is "NoCall" (indicating call ended)
  if (webhookBody.telephonyStatus !== 'NoCall') {
    return null
  }
  
  // Check for activeCalls array (may contain call that just ended)
  const activeCalls = webhookBody.activeCalls as Array<Record<string, unknown>> | undefined
  
  if (!activeCalls || activeCalls.length === 0) {
    // No active calls means the call ended - check if it was missed
    // This is a simplified check - you may need to track state between webhooks
    return null
  }
  
  // Find inbound call that ended without being answered
  const missedCall = activeCalls.find((call) => {
    return (
      call.direction === 'Inbound' &&
      (call.telephonyStatus === 'NoCall' || call.telephonyStatus === 'Ringing')
    )
  })
  
  if (!missedCall) return null
  
  return {
    phone: (missedCall.from as string) || '',
    name: (missedCall.fromName as string) || undefined,
  }
}

// Create new lead (for Zapier webhooks and RingCentral webhooks)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Check if this is a RingCentral webhook
    if (isRingCentralWebhook(body)) {
      console.log('RingCentral webhook received:', JSON.stringify(body, null, 2))
      
      const missedCallInfo = parseRingCentralMissedCall(body)
      
      if (!missedCallInfo) {
        // Not a missed call event, acknowledge and return
        return NextResponse.json({ success: true, message: 'Event processed' })
      }
      
      // Extract missed call details
      const { phone, name } = missedCallInfo
      
      if (!phone) {
        return NextResponse.json(
          { error: 'No phone number in missed call event' },
          { status: 400 }
        )
      }
      
      const normalizedPhone = normalizePhone(phone)
      const displayPhone = formatPhoneDisplay(phone)
      const supabase = createAdminClient()
      
      // Check for duplicate within last 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', normalizedPhone)
        .eq('source', 'missed_call')
        .gte('created_at', oneDayAgo)
        .single()
      
      if (existingLead) {
        console.log('Duplicate missed call within 24 hours, skipping')
        return NextResponse.json(
          { success: true, message: 'Duplicate call ignored' },
          { status: 200 }
        )
      }
      
      // Create lead for missed call
      const { data, error } = await supabase
        .from('leads')
        .insert({
          source: 'missed_call',
          name: name || 'Unknown Caller',
          phone: normalizedPhone,
          status: 'new',
          notes: 'Missed call - auto-created',
        })
        .select()
        .single()
      
      if (error) {
        console.error('Error creating missed call lead:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      
      console.log('Missed call lead created:', data.id)
      
      // Send SMS response via RingCentral
      await sendRingCentralSMS(
        normalizedPhone,
        "Thanks for calling Sasquatch Carpet Cleaning! Sorry we missed you. We'll call you back shortly. Text us anytime at this number!"
      )
      
      // Send OneSignal push notification to admin
      await sendOneSignalNotification({
        heading: '📞 Missed Call',
        content: `New missed call from ${name || displayPhone}`,
        data: {
          type: 'missed_call',
          lead_id: data.id,
          phone: normalizedPhone,
          name: name || 'Unknown',
        },
      })
      
      return NextResponse.json({ success: true, lead: data }, { status: 201 })
    }
    
    // Standard lead creation (from Zapier or manual)
    const { source, name, phone, email, location, notes, partner_id } = body

    // Validate required fields
    if (!phone) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    if (!source || !['contest', 'partner', 'missed_call', 'website'].includes(source)) {
      return NextResponse.json(
        { error: 'Valid source is required (contest, partner, missed_call, website)' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Check for duplicate by phone (within last 24 hours from same source)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const normalizedPhone = normalizePhone(phone)

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .eq('source', source)
      .gte('created_at', oneDayAgo)
      .single()

    if (existingLead) {
      return NextResponse.json(
        { message: 'Duplicate lead within 24 hours', lead_id: existingLead.id },
        { status: 200 }
      )
    }

    // Insert new lead
    const { data, error } = await supabase
      .from('leads')
      .insert({
        source,
        name: name || null,
        phone: normalizedPhone,
        email: email || null,
        location: location || null,
        notes: notes || null,
        partner_id: partner_id || null,
        status: 'new',
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating lead:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Send OneSignal notification for new lead
    const sourceLabels: Record<string, string> = {
      contest: 'Contest Entry',
      partner: 'Partner Referral',
      missed_call: 'Missed Call',
      website: 'Website Form',
    }
    const sourceLabel = sourceLabels[source] || source

    await sendOneSignalNotification({
      heading: `🎯 New ${sourceLabel}`,
      content: `${name || 'Unknown'} - ${formatPhoneDisplay(phone)}`,
      data: {
        type: 'new_lead',
        lead_id: data.id,
        source,
      },
    })

    return NextResponse.json({ success: true, lead: data }, { status: 201 })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to create lead' },
      { status: 500 }
    )
  }
}

// Update lead (status, notes, etc.)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, status, notes, name, email, location } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Lead ID is required' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {}
    
    if (status !== undefined) {
      if (!['new', 'contacted', 'quoted', 'scheduled', 'won', 'lost'].includes(status)) {
        return NextResponse.json(
          { error: 'Invalid status' },
          { status: 400 }
        )
      }
      updateData.status = status

      // Set timestamp based on status change
      const now = new Date().toISOString()
      if (status === 'contacted') {
        updateData.contacted_at = now
      } else if (status === 'scheduled') {
        updateData.scheduled_at = now
      } else if (status === 'won') {
        updateData.won_at = now
      }
    }

    if (notes !== undefined) updateData.notes = notes
    if (name !== undefined) updateData.name = name
    if (email !== undefined) updateData.email = email
    if (location !== undefined) updateData.location = location

    const { data, error } = await supabase
      .from('leads')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating lead:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, lead: data })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to update lead' },
      { status: 500 }
    )
  }
}

// Delete lead
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const leadId = searchParams.get('id')

    if (!leadId) {
      return NextResponse.json(
        { error: 'Lead ID is required' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', leadId)

    if (error) {
      console.error('Error deleting lead:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to delete lead' },
      { status: 500 }
    )
  }
}

// Get all leads (for admin dashboard)
export async function GET() {
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('leads')
      .select(`
        *,
        partner:partners(name, company_name)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching leads:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ leads: data })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch leads' },
      { status: 500 }
    )
  }
}
