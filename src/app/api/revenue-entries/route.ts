/**
 * Revenue Entries API
 * Quick entry for tracking revenue/hours without job posts
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { entry_date, description, invoice_amount, hours_worked } = body

    // Validate required fields
    if (!description || !invoice_amount || !hours_worked) {
      return NextResponse.json(
        { error: 'Description, invoice amount, and hours worked are required' },
        { status: 400 }
      )
    }

    // Insert revenue entry
    const { data: entry, error } = await supabase
      .from('revenue_entries')
      .insert({
        user_id: user.id,
        entry_date: entry_date || new Date().toISOString().split('T')[0],
        description,
        invoice_amount: parseFloat(invoice_amount),
        hours_worked: parseFloat(hours_worked),
      })
      .select()
      .single()

    if (error) {
      console.error('Insert error:', error)
      return NextResponse.json(
        { error: 'Failed to create revenue entry' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, entry })
  } catch (error) {
    console.error('Revenue entry API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: entries, error } = await supabase
      .from('revenue_entries')
      .select('*')
      .eq('user_id', user.id)
      .order('entry_date', { ascending: false })

    if (error) {
      console.error('Fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch entries' },
        { status: 500 }
      )
    }

    return NextResponse.json({ entries })
  } catch (error) {
    console.error('Revenue entries API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
