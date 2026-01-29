import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

// Get partner's outbound referrals (work sent TO them)
export async function GET() {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get partner ID
    const { data: partner } = await supabase
      .from('partners')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    // Get outbound referrals for this partner
    const { data, error } = await supabase
      .from('outbound_referrals')
      .select('*')
      .eq('partner_id', partner.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching outbound referrals:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch referrals' },
      { status: 500 },
    )
  }
}

// Partner accepts or declines a referral
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get partner
    const { data: partner } = await supabase
      .from('partners')
      .select('id, referral_balance_owed')
      .eq('user_id', user.id)
      .single()

    if (!partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    const body = await request.json()
    const { referral_id, action } = body // action: 'accept' or 'decline'

    if (!referral_id || !action) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      )
    }

    // Verify the referral belongs to this partner
    const { data: referral } = await supabase
      .from('outbound_referrals')
      .select('*')
      .eq('id', referral_id)
      .eq('partner_id', partner.id)
      .single()

    if (!referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 })
    }

    if (referral.status !== 'pending') {
      return NextResponse.json(
        { error: 'Referral already processed' },
        { status: 400 },
      )
    }

    if (action === 'accept') {
      // Update referral status
      const { error: updateError } = await supabase
        .from('outbound_referrals')
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString(),
          viewed_at: referral.viewed_at || new Date().toISOString(),
        })
        .eq('id', referral_id)

      if (updateError) {
        console.error('Error accepting referral:', updateError)
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 },
        )
      }

      // Add referral fee to partner's balance owed (if any)
      if (referral.referral_fee && referral.referral_fee > 0) {
        await supabase
          .from('partners')
          .update({
            referral_balance_owed:
              (partner.referral_balance_owed || 0) + referral.referral_fee,
          })
          .eq('id', partner.id)
      }

      return NextResponse.json({
        success: true,
        client_name: referral.client_name,
        client_phone: referral.client_phone,
        client_email: referral.client_email,
        notes: referral.notes,
      })
    } else if (action === 'decline') {
      const { error: updateError } = await supabase
        .from('outbound_referrals')
        .update({
          status: 'declined',
          viewed_at: referral.viewed_at || new Date().toISOString(),
        })
        .eq('id', referral_id)

      if (updateError) {
        console.error('Error declining referral:', updateError)
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 },
        )
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to process referral' },
      { status: 500 },
    )
  }
}
