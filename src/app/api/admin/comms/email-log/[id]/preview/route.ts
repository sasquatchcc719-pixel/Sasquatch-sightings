import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { buildEmailHtml } from '@/lib/ops/communications'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])

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
    if (err instanceof Error && err.message === 'Not authorized') {
      return new NextResponse('Unauthorized', { status: 401 })
    }
    console.error('[email-log/preview] Error:', err)
    return new NextResponse('Internal server error', { status: 500 })
  }
}
