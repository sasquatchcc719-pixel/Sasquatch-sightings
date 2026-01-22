import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

// Delete referral
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const referralId = searchParams.get('id')

    if (!referralId) {
      return NextResponse.json({ error: 'Missing referral ID' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('referrals')
      .delete()
      .eq('id', referralId)

    if (error) {
      console.error('Error deleting referral:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Failed to delete referral' }, { status: 500 })
  }
}

// Update referral status
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { referral_id, status, partner_id, credit_amount, previous_status } = body

    if (!referral_id || !status) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Update referral status
    const updateData: Record<string, unknown> = { status }
    if (status === 'converted') {
      updateData.converted_at = new Date().toISOString()
    } else {
      updateData.converted_at = null
    }

    const { error: referralError } = await supabase
      .from('referrals')
      .update(updateData)
      .eq('id', referral_id)

    if (referralError) {
      console.error('Error updating referral:', referralError)
      return NextResponse.json({ error: referralError.message }, { status: 500 })
    }

    // Handle credit adjustments
    if (partner_id && credit_amount) {
      const { data: partner } = await supabase
        .from('partners')
        .select('credit_balance')
        .eq('id', partner_id)
        .single()

      if (partner) {
        let newBalance = partner.credit_balance

        // If changing TO converted, ADD credit
        if (status === 'converted' && previous_status !== 'converted') {
          newBalance = partner.credit_balance + credit_amount
        }
        // If changing FROM converted to something else, SUBTRACT credit
        else if (status !== 'converted' && previous_status === 'converted') {
          newBalance = partner.credit_balance - credit_amount
        }

        if (newBalance !== partner.credit_balance) {
          await supabase
            .from('partners')
            .update({ credit_balance: Math.max(0, newBalance) }) // Don't go negative
            .eq('id', partner_id)
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Failed to update referral' }, { status: 500 })
  }
}

// Add new referral
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { partner_id, client_name, client_phone, notes, credit_amount } = body

    if (!partner_id || !client_name || !client_phone) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Use admin client to bypass RLS
    const supabase = createAdminClient()

    const { data, error } = await supabase.from('referrals').insert({
      partner_id,
      client_name,
      client_phone,
      notes: notes || null,
      status: 'pending',
      credit_amount: credit_amount || 20,
      booked_via_link: false,
    }).select()

    if (error) {
      console.error('Error adding referral:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to add referral' },
      { status: 500 }
    )
  }
}
