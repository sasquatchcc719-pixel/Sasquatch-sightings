import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { buildEmailHtml } from '@/lib/ops/communications'
import { buildReactivationEmailHtml } from '@/lib/ops/reactivation-campaign'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])

    const { id } = await params
    const source = request.nextUrl.searchParams.get('source') || 'jobs'
    const supabase = createAdminClient()

    if (source === 'reactivation') {
      const { data, error } = await supabase
        .from('reactivation_email_log')
        .select('body_text, template_key, subject, customer_id')
        .eq('id', id)
        .single()
      if (error || !data) {
        return new NextResponse('Email log entry not found', { status: 404 })
      }
      // The same builder the sender uses, so the preview cannot drift from
      // what actually goes out.
      const html = buildReactivationEmailHtml(
        data.body_text || `(body not stored)\n\nSubject: ${data.subject || ''}`,
        data.customer_id || '',
      )
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    if (source === 'drip') {
      const { data, error } = await supabase
        .from('drip_email_log')
        .select('subject, template_label')
        .eq('id', id)
        .single()
      if (error || !data) {
        return new NextResponse('Email log entry not found', { status: 404 })
      }
      // Drip log stores only the subject - point at the template for the body.
      const html = buildEmailHtml(
        `Subject: ${data.subject || '(no subject)'}\n\nThe drip system does not store the full body per send - see the "${data.template_label || ''}" template in the drip settings for the content.`,
        'drip',
      )
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

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
