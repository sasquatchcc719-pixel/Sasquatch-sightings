import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

// Update partner (balance, backlink status, etc.)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { partner_id, new_balance, backlink_verified, backlink_opted_in } = body

    if (!partner_id) {
      return NextResponse.json(
        { error: 'Missing partner_id' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Build update object based on what was provided
    const updateData: Record<string, unknown> = {}
    
    if (new_balance !== undefined) {
      updateData.credit_balance = new_balance
    }
    if (backlink_verified !== undefined) {
      updateData.backlink_verified = backlink_verified
    }
    if (backlink_opted_in !== undefined) {
      updateData.backlink_opted_in = backlink_opted_in
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('partners')
      .update(updateData)
      .eq('id', partner_id)

    if (error) {
      console.error('Error updating partner:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Failed to update partner' }, { status: 500 })
  }
}
