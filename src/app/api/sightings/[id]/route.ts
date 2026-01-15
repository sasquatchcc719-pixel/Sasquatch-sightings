/**
 * Sightings Update API Route Handler
 * Handles updating sighting records (admin only)
 * Requires authentication
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check authentication
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Validate sighting ID
    if (!id) {
      return NextResponse.json(
        { error: 'Sighting ID is required' },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { coupon_redeemed } = body

    // Validate input
    if (typeof coupon_redeemed !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid coupon_redeemed value' },
        { status: 400 }
      )
    }

    // Update sighting record
    const { data: sighting, error: updateError } = await supabase
      .from('sightings')
      .update({ coupon_redeemed })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('Database update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update sighting' },
        { status: 500 }
      )
    }

    // Return success
    return NextResponse.json(
      {
        success: true,
        sighting,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Update API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
