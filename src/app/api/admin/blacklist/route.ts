import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'
import { normalizePhone } from '@/lib/blacklist'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('blacklist')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ entries: data ?? [] })
  } catch (err) {
    console.error('[admin/blacklist][GET]', err)
    return NextResponse.json(
      { error: 'Failed to load blacklist' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const body = await request.json()
    const phone =
      typeof body.phone === 'string' ? normalizePhone(body.phone) : ''
    if (phone.length !== 10) {
      return NextResponse.json(
        { error: 'Valid 10-digit phone number required' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('blacklist')
      .insert({
        phone,
        name: body.name?.trim() || null,
        reason: body.reason?.trim() || null,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'That phone number is already blacklisted' },
          { status: 409 },
        )
      }
      throw error
    }

    return NextResponse.json({ entry: data }, { status: 201 })
  } catch (err) {
    console.error('[admin/blacklist][POST]', err)
    return NextResponse.json(
      { error: 'Failed to add to blacklist' },
      { status: 500 },
    )
  }
}
