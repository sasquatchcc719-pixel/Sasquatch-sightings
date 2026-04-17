import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole, hasRoleAccess } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { buildEmailHtml } from '@/lib/ops/communications'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !hasRoleAccess(role, ['admin', 'owner'])) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { id } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('ops_email_log')
      .select('body_text, template_key')
      .eq('id', id)
      .single()

    if (error || !data) {
      return new NextResponse('Email log entry not found', { status: 404 })
    }

    const html = buildEmailHtml(data.body_text || '', data.template_key)

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (err) {
    console.error('[email-log/preview] Error:', err)
    return new NextResponse('Internal server error', { status: 500 })
  }
}
