import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { createSightingPost } from '@/lib/google-business'

type Params = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params

    const { data: draft, error: fetchError } = await supabase
      .from('social_post_drafts')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }

    if (draft.status === 'posted') {
      return NextResponse.json({ error: 'Already posted' }, { status: 400 })
    }

    const postText = draft.body as string

    // Post to Google Business Profile directly
    let gbpOk = false
    let gbpError: string | null = null
    try {
      // Text-only GBP posts don't require an image — pass empty string to skip media
      await createSightingPost('', postText)
      gbpOk = true
      console.log(`[social-post-drafts] GBP post succeeded for draft ${id}`)
    } catch (gbpErr) {
      gbpError =
        gbpErr instanceof Error
          ? gbpErr.message
          : 'Google Business Profile post failed'
      console.error(
        `[social-post-drafts] GBP post failed for draft ${id}:`,
        gbpErr,
      )
    }

    // Fire Zapier for Facebook / LinkedIn / Instagram
    let zapierOk = false
    let zapierError: string | null = process.env.ZAPIER_WEBHOOK_URL
      ? null
      : 'ZAPIER_WEBHOOK_URL is not configured.'
    if (process.env.ZAPIER_WEBHOOK_URL) {
      try {
        const zapierResponse = await fetch(process.env.ZAPIER_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: postText,
            title: draft.title ?? '',
            post_type: draft.post_type,
            image_url: draft.image_url ?? '',
            source: 'social_draft',
          }),
        })
        zapierOk = zapierResponse.ok
        if (!zapierResponse.ok) {
          zapierError = `Zapier webhook returned ${zapierResponse.status}: ${(
            await zapierResponse.text()
          ).slice(0, 300)}`
        }
      } catch (zapErr) {
        zapierError =
          zapErr instanceof Error ? zapErr.message : 'Zapier webhook failed'
        console.error(
          `[social-post-drafts] Zapier failed for draft ${id}:`,
          zapErr,
        )
      }
    }

    if (!gbpOk && !zapierOk) {
      return NextResponse.json(
        {
          error: 'Google Business Profile and Zapier both failed.',
          channels: {
            googleBusiness: { ok: gbpOk, error: gbpError },
            zapier: { ok: zapierOk, error: zapierError },
          },
        },
        { status: 502 },
      )
    }

    // Mark posted
    await supabase
      .from('social_post_drafts')
      .update({ status: 'posted', posted_at: new Date().toISOString() })
      .eq('id', id)

    return NextResponse.json({
      ok: true,
      channels: {
        googleBusiness: { ok: gbpOk, error: gbpError },
        zapier: { ok: zapierOk, error: zapierError },
      },
    })
  } catch (err) {
    console.error('[social-post-drafts POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to post draft' },
      { status: 500 },
    )
  }
}
