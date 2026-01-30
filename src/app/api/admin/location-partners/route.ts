/**
 * Location Partners API
 * GET - List all location partners
 * POST - Create a new location partner
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    const supabase = await createAdminClient()

    const { data, error } = await supabase
      .from('partners')
      .select('*')
      .eq('partner_type', 'location')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch location partners:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ partners: data })
  } catch (error) {
    console.error('Error fetching location partners:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient()
    const body = await request.json()

    const {
      company_name,
      location_name,
      location_address,
      location_type,
      phone,
      card_id,
    } = body

    if (!company_name) {
      return NextResponse.json(
        { error: 'company_name is required' },
        { status: 400 },
      )
    }

    // Generate a placeholder email from company name
    const slugifiedName = company_name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    const placeholderEmail = `${slugifiedName}@location-partner.sasquatchcarpet.com`

    // Create the location partner
    // Note: We provide placeholder values for legacy required fields (user_id, home_address, phone)
    // that were designed for referral partners. The migration should drop these constraints.
    const { data, error } = await supabase
      .from('partners')
      .insert({
        name: company_name, // Required field
        email: placeholderEmail, // Required field - placeholder for location partners
        phone: phone || 'N/A', // Provide default for legacy NOT NULL constraint
        home_address: location_address || 'N/A - Location Partner', // Provide default for legacy NOT NULL constraint
        company_name,
        location_name: location_name || null,
        location_address: location_address || null,
        location_type: location_type || null,
        card_id: card_id || null,
        partner_type: 'location',
        role: 'partner',
        credit_balance: 0,
        total_taps: 0,
        total_conversions: 0,
      })
      .select()
      .single()

    if (error) {
      console.error('Failed to create location partner:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, partner: data })
  } catch (error) {
    console.error('Error creating location partner:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
