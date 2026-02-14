/**
 * Confirm a location partner conversion and award credit
 * POST /api/admin/location-partners/confirm
 *
 * Credit is 1% of job value (sliding scale)
 * - $100 job = $1 credit
 * - $500 job = $5 credit
 * - $1000 job = $10 credit
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

const CREDIT_PERCENTAGE = 0.01 // 1% of job value

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient()
    const body = await request.json()
    const { tapId, partnerId, jobAmount } = body

    if (!tapId || !partnerId) {
      return NextResponse.json(
        { error: 'tapId and partnerId are required' },
        { status: 400 },
      )
    }

    if (!jobAmount || jobAmount <= 0) {
      return NextResponse.json(
        { error: 'jobAmount is required and must be greater than 0' },
        { status: 400 },
      )
    }

    // Calculate credit (1% of job value, rounded to nearest cent)
    const creditAmount = Math.round(jobAmount * CREDIT_PERCENTAGE * 100) / 100

    // Get the tap to verify it exists and belongs to this partner
    const { data: tap, error: tapError } = await supabase
      .from('nfc_card_taps')
      .select('*')
      .eq('id', tapId)
      .eq('partner_id', partnerId)
      .single()

    if (tapError || !tap) {
      return NextResponse.json({ error: 'Tap not found' }, { status: 404 })
    }

    // Check if already confirmed
    if (tap.converted) {
      return NextResponse.json(
        { error: 'This conversion has already been confirmed' },
        { status: 400 },
      )
    }

    // Mark as confirmed
    await supabase
      .from('nfc_card_taps')
      .update({
        converted: true,
        converted_at: new Date().toISOString(),
      })
      .eq('id', tapId)

    // Get partner details
    const { data: partner, error: partnerError } = await supabase
      .from('partners')
      .select('*')
      .eq('id', partnerId)
      .single()

    if (partnerError || !partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    // Award credit (1% of job value)
    const newBalance =
      Math.round(((partner.credit_balance || 0) + creditAmount) * 100) / 100
    const newConversions = (partner.total_conversions || 0) + 1

    await supabase
      .from('partners')
      .update({
        credit_balance: newBalance,
        total_conversions: newConversions,
      })
      .eq('id', partnerId)

    // Send SMS notification to partner
    if (partner.phone) {
      try {
        await fetch(
          `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/sms/send`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: partner.phone,
              message: `🎉 Great news! A $${jobAmount} job just booked from your ${partner.location_name || partner.company_name} NFC card! You earned $${creditAmount.toFixed(2)} credit (1%). New balance: $${newBalance.toFixed(2)}. Thanks for partnering with Sasquatch!`,
            }),
          },
        )
      } catch (error) {
        console.error('Failed to send SMS notification:', error)
      }
    }

    return NextResponse.json({
      success: true,
      jobAmount,
      creditAwarded: creditAmount,
      newBalance,
      newConversions,
    })
  } catch (error) {
    console.error('Error confirming conversion:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
