import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/supabase/server'
import { z } from 'zod'

const referralDecision = z
  .object({ referral_id: z.uuid(), action: z.enum(['accept', 'decline']) })
  .strict()
const decisionReceipt = z.object({
  success: z.literal(true),
  referral_id: z.uuid(),
  status: z.enum(['accepted', 'completed', 'declined']),
  replayed: z.boolean(),
  client_name: z.string().optional(),
  client_phone: z.string().optional(),
  client_email: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

// Get partner's outbound referrals (work sent TO them)
export async function GET() {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user || user.is_anonymous) {
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

// Identity is verified with the session; only the server can record a decision
// and apply the saved fee through one atomic, retry-safe transaction.
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user || user.is_anonymous) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const submitted = referralDecision.safeParse(
      await request.json().catch(() => null),
    )
    if (!submitted.success) {
      return NextResponse.json(
        { error: 'A referral ID and accept or decline action are required.' },
        { status: 400 },
      )
    }

    const admin = createAdminClient()
    const { data, error } = await admin.rpc(
      'review_partner_outbound_referral',
      {
        p_user_id: user.id,
        p_referral_id: submitted.data.referral_id,
        p_action: submitted.data.action,
      },
    )
    if (error) {
      console.error('Partner referral decision failed:', error)
      return NextResponse.json(
        { error: 'Failed to process referral. Retry the same decision.' },
        { status: 500 },
      )
    }
    if (data?.success === false) {
      const status =
        data.code === 'PARTNER_NOT_FOUND'
          ? 403
          : data.code === 'REFERRAL_NOT_FOUND'
            ? 404
            : data.code === 'DECISION_CONFLICT'
              ? 409
              : 400
      return NextResponse.json(
        {
          error:
            status === 409
              ? 'Referral already has a different decision.'
              : 'Referral is not available.',
        },
        { status },
      )
    }
    const receipt = decisionReceipt.safeParse(data)
    if (
      !receipt.success ||
      receipt.data.referral_id !== submitted.data.referral_id ||
      (submitted.data.action === 'accept' &&
        (receipt.data.status === 'declined' ||
          !receipt.data.client_name ||
          !receipt.data.client_phone)) ||
      (submitted.data.action === 'decline' &&
        receipt.data.status !== 'declined')
    ) {
      return NextResponse.json(
        {
          error:
            'Could not verify the saved decision. Retry the same decision.',
        },
        { status: 500 },
      )
    }
    return NextResponse.json(receipt.data)
  } catch (error) {
    console.error('Partner referral decision error:', error)
    return NextResponse.json(
      { error: 'Failed to process referral. Retry the same decision.' },
      { status: 500 },
    )
  }
}
