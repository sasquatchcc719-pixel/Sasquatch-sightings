import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'
import { createAdminClient } from '@/supabase/server'
import { z } from 'zod'

const referralSubmission = z
  .object({
    client_name: z.string().trim().min(1).max(200),
    client_phone: z.string().trim().min(1).max(50),
    notes: z.string().trim().max(3000).nullable().optional(),
    // Retain old ordinary submissions, but never accept a booking claim.
    booked_via_link: z.literal(false).optional(),
  })
  .strict()

/**
 * Partner submits a pending referral. Booking and credit require server evidence.
 * Does referral + lead insert server-side with admin client so RLS on leads
 * never blocks (no trigger or partner RLS policy needed).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: partner, error: partnerError } = await supabase
      .from('partners')
      .select('id, backlink_verified')
      .eq('user_id', user.id)
      .single()

    if (partnerError || !partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 403 })
    }

    const submitted = referralSubmission.safeParse(
      await request.json().catch(() => null),
    )
    if (!submitted.success) {
      return NextResponse.json(
        {
          error:
            'Submit client name, phone, and optional notes only. Bookings and credits are verified separately.',
        },
        { status: 400 },
      )
    }
    const { client_name, client_phone, notes } = submitted.data

    const creditAmount = partner.backlink_verified ? 25 : 20
    const admin = createAdminClient()

    // 1. Insert referral (admin bypasses RLS)
    const { data: referralData, error: referralError } = await admin
      .from('referrals')
      .insert({
        partner_id: partner.id,
        client_name: client_name.trim(),
        client_phone: client_phone.trim(),
        notes: notes?.trim() || null,
        status: 'pending',
        credit_amount: creditAmount,
        booked_via_link: false,
      })
      .select('id')
      .single()

    if (referralError) {
      console.error('Referral insert error:', referralError)
      return NextResponse.json(
        {
          error:
            referralError.code === '23505'
              ? 'This referral has already been submitted.'
              : 'Failed to submit referral',
        },
        { status: referralError.code === '23505' ? 409 : 500 },
      )
    }
    if (!referralData?.id) {
      return NextResponse.json(
        { error: 'Failed to verify saved referral' },
        { status: 500 },
      )
    }

    // 2. Insert lead for unified tracking (admin bypasses RLS)
    const { error: leadError } = await admin.from('leads').insert({
      source: 'partner',
      name: client_name.trim(),
      phone: client_phone.trim(),
      notes: notes?.trim() || null,
      partner_id: partner.id,
      status: 'new',
    })

    // The referral is already saved: a tracking failure must not invite a
    // resubmission that creates another referral. No balance is changed here.
    if (leadError)
      console.error('Partner referral lead tracking error:', leadError)

    return NextResponse.json({
      success: true,
      referral_id: referralData.id,
      status: 'pending',
      credit_awarded: false,
    })
  } catch (error) {
    console.error('Partner referral API error:', error)
    return NextResponse.json(
      { error: 'Failed to submit referral' },
      { status: 500 },
    )
  }
}
