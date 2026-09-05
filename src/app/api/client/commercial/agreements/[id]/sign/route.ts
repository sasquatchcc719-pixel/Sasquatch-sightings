import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAuthClient } from '@supabase/supabase-js'
import { requireClientManager } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { agreementHash } from '@/lib/ops/commercial-server'
import { SIGNATURE_CONSENT, type AgreementContent } from '@/lib/ops/commercial'
import { z } from 'zod'
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, client } = await requireClientManager()
    if (!client.can_sign_agreements)
      return NextResponse.json(
        {
          error:
            'Your login is not authorized to sign agreements. Contact Sasquatch.',
        },
        { status: 403 },
      )
    const { id } = await params
    const body = z
      .object({
        name: z.string().trim().min(2).max(200),
        title: z.string().trim().min(2).max(200),
        password: z.string().min(1).max(500),
        consent: z.literal(true),
        content_hash: z.string().length(64),
      })
      .parse(await request.json())
    const db = createAdminClient()
    const { data: agreement, error } = await db
      .from('ops_commercial_agreements')
      .select('content,content_hash,status,revision')
      .eq('id', id)
      .eq('customer_id', client.customer_id)
      .maybeSingle()
    if (error) throw error
    if (!agreement)
      return NextResponse.json(
        { error: 'Agreement not found' },
        { status: 404 },
      )
    if (
      agreement.status !== 'published' ||
      agreement.content_hash !== body.content_hash ||
      agreementHash(agreement.content as AgreementContent) !== body.content_hash
    )
      return NextResponse.json(
        {
          error:
            'This agreement is no longer available to sign. Reload and review the current version.',
        },
        { status: 409 },
      )
    // A fresh password check proves control of the customer account, including for legacy preview sessions.
    const verifier = createAuthClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data: identity, error: authError } =
      await verifier.auth.signInWithPassword({
        email: user.email,
        password: body.password,
      })
    if (authError || identity.user?.id !== user.id)
      return NextResponse.json(
        { error: 'Password verification failed.' },
        { status: 403 },
      )
    const temporary = identity.user.app_metadata?.must_change_password === true
    await verifier.auth.signOut({ scope: 'local' })
    if (temporary)
      return NextResponse.json(
        { error: 'Set your own password before signing.' },
        { status: 403 },
      )
    const { data: signed, error: signError } = await db
      .from('ops_commercial_agreements')
      .update({
        status: 'signed',
        signed_by: user.id,
        signed_name: body.name,
        signed_title: body.title,
        signed_email: user.email,
        signed_at: new Date().toISOString(),
        signature_consent: SIGNATURE_CONSENT,
        signature_ip:
          request.headers
            .get('x-forwarded-for')
            ?.split(',')[0]
            ?.slice(0, 100) || null,
        signature_user_agent:
          request.headers.get('user-agent')?.slice(0, 1000) || null,
      })
      .eq('id', id)
      .eq('customer_id', client.customer_id)
      .eq('status', 'published')
      .eq('revision', agreement.revision)
      .select('id')
      .maybeSingle()
    if (signError) throw signError
    if (!signed)
      return NextResponse.json(
        { error: 'Agreement changed before signing. Reload to review it.' },
        { status: 409 },
      )
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof z.ZodError
            ? 'Complete all signature fields and consent.'
            : 'Unable to sign agreement',
      },
      {
        status:
          e instanceof Error && e.message === 'Not a client manager'
            ? 403
            : 400,
      },
    )
  }
}
