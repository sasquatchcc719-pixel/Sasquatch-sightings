import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendOneSignalNotification } from '@/lib/onesignal'
import { sendAdminSMS, sendPartnerSMS, sendCustomerSMS } from '@/lib/twilio'

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
        .select('credit_balance, phone, name')
        .eq('id', partner_id)
        .single()

      if (partner) {
        let newBalance = partner.credit_balance

        // If changing TO converted, ADD credit
        if (status === 'converted' && previous_status !== 'converted') {
          newBalance = partner.credit_balance + credit_amount
          
          // Get referral details for notification
          const { data: referral } = await supabase
            .from('referrals')
            .select('client_name')
            .eq('id', referral_id)
            .single()

          // Count total converted referrals for this partner
          const { count } = await supabase
            .from('referrals')
            .select('*', { count: 'exact', head: true })
            .eq('partner_id', partner_id)
            .eq('status', 'converted')

          // Send partner credit notification
          if (partner.phone && referral) {
            await sendPartnerSMS(
              partner.phone,
              `🎉 Referral Converted!\n${referral.client_name} just booked a job!\nYou earned: $${credit_amount} credit\nYour balance: $${newBalance.toFixed(2)}\nTotal referrals: ${count || 1}\n- Sasquatch Carpet Cleaning`
            )
          }
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

    // Also add to leads table for unified lead tracking
    try {
      await supabase.from('leads').insert({
        source: 'partner',
        name: client_name,
        phone: client_phone,
        notes: notes || null,
        partner_id: partner_id,
        status: 'new',
      })
      console.log('Lead created from partner referral')
    } catch (leadError) {
      // Log but don't fail - referral was already saved
      console.error('Failed to create lead from referral:', leadError)
    }

    // Get partner info for notifications
    const { data: partner } = await supabase
      .from('partners')
      .select('name, phone')
      .eq('id', partner_id)
      .single()

    // Send notifications about new partner referral
    // OneSignal (backup - for desktop browser notifications)
    await sendOneSignalNotification({
      heading: '🤝 New Partner Referral',
      content: `${client_name} referred by ${partner?.name || 'partner'}`,
      data: {
        type: 'partner_referral',
        referral_id: data[0].id,
        partner_id,
        client_name,
      },
    })

    // Twilio SMS to admin (primary notification)
    await sendAdminSMS(
      `🤝 New Partner Referral\n${client_name} - ${client_phone}\nReferred by: ${partner?.name || 'Unknown partner'}`
    )

    // Twilio SMS to partner (notify them they got a referral!)
    if (partner?.phone) {
      await sendPartnerSMS(
        partner.phone,
        `🎉 New Referral!\n${client_name} mentioned you as their preferred partner.\nWe'll be in touch soon!\n- Sasquatch Carpet Cleaning`
      )
    }

    // Twilio SMS to customer (auto-response with booking link)
    await sendCustomerSMS(
      client_phone,
      `Thanks for reaching out! ${partner?.name || 'Your partner'} recommended us.\nBook now or we'll call you within 24 hours:\nhttps://book.housecallpro.com/book/Sasquatch-Carpet-Cleaning-LLC/9841a0d5dee444b48d42e926168cb865?v2=true\n- Sasquatch Carpet Cleaning\n(719) 249-8791`
    )

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to add referral' },
      { status: 500 }
    )
  }
}
