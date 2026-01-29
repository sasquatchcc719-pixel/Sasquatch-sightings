import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendPartnerSMS } from '@/lib/twilio'

// Get all outbound referrals
export async function GET() {
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('outbound_referrals')
      .select(
        `
        *,
        partner:partners(id, name, phone, company_name)
      `,
      )
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching outbound referrals:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch outbound referrals' },
      { status: 500 },
    )
  }
}

// Create new outbound referral (admin sends work to partner)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      partner_id,
      client_name,
      client_phone,
      client_email,
      description,
      notes,
      referral_fee,
    } = body

    if (!partner_id || !client_name || !client_phone || !description) {
      return NextResponse.json(
        {
          error:
            'Missing required fields (partner_id, client_name, client_phone, description)',
        },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    // Create the outbound referral
    const { data, error } = await supabase
      .from('outbound_referrals')
      .insert({
        partner_id,
        client_name,
        client_phone,
        client_email: client_email || null,
        description,
        notes: notes || null,
        referral_fee: referral_fee || 0,
        status: 'pending',
      })
      .select()

    if (error) {
      console.error('Error creating outbound referral:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get partner info for SMS
    const { data: partner } = await supabase
      .from('partners')
      .select('name, phone')
      .eq('id', partner_id)
      .single()

    // Send SMS to partner with login link
    if (partner?.phone) {
      const feeText = referral_fee > 0 ? `for $${referral_fee}` : 'at no charge'
      const loginUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        'https://sightings.sasquatchcarpet.com'

      await sendPartnerSMS(
        partner.phone,
        `Sasquatch Carpet Cleaning wants to refer: ${description} ${feeText}.\n\nAccept here: ${loginUrl}/partners\n\n- Sasquatch Carpet Cleaning`,
        partner_id,
        'outbound_referral_sent',
      )
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to create outbound referral' },
      { status: 500 },
    )
  }
}

// Update outbound referral (status changes)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { referral_id, status, partner_id, referral_fee } = body

    if (!referral_id || !status) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    // Build update object
    const updateData: Record<string, unknown> = { status }

    if (status === 'accepted') {
      updateData.accepted_at = new Date().toISOString()

      // Add fee to partner's balance owed (if applicable)
      if (partner_id && referral_fee && referral_fee > 0) {
        const { data: partner } = await supabase
          .from('partners')
          .select('referral_balance_owed')
          .eq('id', partner_id)
          .single()

        if (partner) {
          await supabase
            .from('partners')
            .update({
              referral_balance_owed:
                (partner.referral_balance_owed || 0) + referral_fee,
            })
            .eq('id', partner_id)
        }
      }
    } else if (status === 'completed') {
      updateData.completed_at = new Date().toISOString()
    } else if (status === 'declined') {
      // No additional action needed
    }

    const { error } = await supabase
      .from('outbound_referrals')
      .update(updateData)
      .eq('id', referral_id)

    if (error) {
      console.error('Error updating outbound referral:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to update outbound referral' },
      { status: 500 },
    )
  }
}

// Delete outbound referral
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const referralId = searchParams.get('id')

    if (!referralId) {
      return NextResponse.json(
        { error: 'Missing referral ID' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('outbound_referrals')
      .delete()
      .eq('id', referralId)

    if (error) {
      console.error('Error deleting outbound referral:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to delete outbound referral' },
      { status: 500 },
    )
  }
}
