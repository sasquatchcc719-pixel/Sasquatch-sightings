import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params

    const body = (await request.json()) as {
      title?: string
      body?: string
      status?: 'draft' | 'rejected'
    }

    const updates: Record<string, unknown> = {}
    if (body.title !== undefined) updates.title = body.title
    if (body.body !== undefined) updates.body = body.body
    if (body.status !== undefined) updates.status = body.status

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('social_post_drafts')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ ok: true, draft: data })
  } catch (err) {
    console.error('[social-post-drafts PATCH]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update draft' },
      { status: 500 },
    )
  }
}
