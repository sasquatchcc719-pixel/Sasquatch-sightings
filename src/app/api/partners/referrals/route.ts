import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'
import { createAdminClient } from '@/supabase/server'

/**
 * Partner submits a referral (or "Book for Client").
 * Does referral + lead insert server-side with admin client so RLS on leads
 * never blocks (no trigger or partner RLS policy needed).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: partner } = await supabase
      .from('partners')
      .select('id, credit_balance, backlink_verified')
      .eq('user_id', user.id)
      .single()

    if (!partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 403 })
    }

    const body = await request.json()
    const {
      client_name,
      client_phone,
      notes,
      booked_via_link = false,
    } = body as {
      client_name: string
      client_phone: string
      notes?: string | null
      booked_via_link?: boolean
    }

    if (!client_name?.trim() || !client_phone?.trim()) {
      return NextResponse.json(
        { error: 'Client name and phone are required' },
        { status: 400 },
      )
    }

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
        status: booked_via_link ? 'booked' : 'pending',
        credit_amount: creditAmount,
        booked_via_link: !!booked_via_link,
      })
      .select('id')
      .single()

    if (referralError) {
      console.error('Referral insert error:', referralError)
      return NextResponse.json(
        { error: referralError.message },
        { status: 500 },
      )
    }

    // 2. Insert lead for unified tracking (admin bypasses RLS)
    const now = new Date().toISOString()
    await admin.from('leads').insert({
      source: 'partner',
      name: client_name.trim(),
      phone: client_phone.trim(),
      notes: notes?.trim() || null,
      partner_id: partner.id,
      status: 'contacted',
      contacted_at: now,
    })

    // 3. If "Book for Client", add credit immediately
    if (booked_via_link) {
      await admin
        .from('partners')
        .update({
          credit_balance: partner.credit_balance + creditAmount,
        })
        .eq('id', partner.id)
    }

    return NextResponse.json({
      success: true,
      referral_id: referralData?.id,
    })
  } catch (error) {
    console.error('Partner referral API error:', error)
    return NextResponse.json(
      { error: 'Failed to submit referral' },
      { status: 500 },
    )
  }
}
