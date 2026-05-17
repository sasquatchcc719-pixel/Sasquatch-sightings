import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const supabase = createAdminClient()
    const { error } = await supabase.from('blacklist').delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[admin/blacklist][DELETE]', err)
    return NextResponse.json(
      { error: 'Failed to remove entry' },
      { status: 500 },
    )
  }
}
