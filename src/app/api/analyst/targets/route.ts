import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/supabase/server'

// GET - List all targets
export async function GET() {
  try {
    const supabase = await createClient()

    const { data: targets, error } = await supabase
      .from('market_intel_targets')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching targets:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ targets })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch targets' },
      { status: 500 },
    )
  }
}

// POST - Create new target
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { type, value, source, url, notes } = body

    if (!type || !value || !source) {
      return NextResponse.json(
        { error: 'Missing required fields: type, value, source' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('market_intel_targets')
      .insert({
        type,
        value,
        source,
        url: url || null,
        notes: notes || null,
        is_active: true,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating target:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ target: data })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to create target' },
      { status: 500 },
    )
  }
}

// PATCH - Update target
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, type, value, source, url, notes, is_active } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing target id' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (type !== undefined) updateData.type = type
    if (value !== undefined) updateData.value = value
    if (source !== undefined) updateData.source = source
    if (url !== undefined) updateData.url = url
    if (notes !== undefined) updateData.notes = notes
    if (is_active !== undefined) updateData.is_active = is_active

    const { data, error } = await supabase
      .from('market_intel_targets')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating target:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ target: data })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to update target' },
      { status: 500 },
    )
  }
}

// DELETE - Remove target
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing target id' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('market_intel_targets')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting target:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to delete target' },
      { status: 500 },
    )
  }
}
