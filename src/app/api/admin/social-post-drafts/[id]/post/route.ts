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
    try {
      // Text-only GBP posts don't require an image — pass empty string to skip media
      await createSightingPost('', postText)
      gbpOk = true
      console.log(`[social-post-drafts] GBP post succeeded for draft ${id}`)
    } catch (gbpErr) {
      console.error(
        `[social-post-drafts] GBP post failed for draft ${id}:`,
        gbpErr,
      )
    }

    // Fire Zapier for Facebook / LinkedIn / Instagram
    let zapierOk = false
    if (process.env.ZAPIER_WEBHOOK_URL) {
      try {
        await fetch(process.env.ZAPIER_WEBHOOK_URL, {
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
        zapierOk = true
      } catch (zapErr) {
        console.error(
          `[social-post-drafts] Zapier failed for draft ${id}:`,
          zapErr,
        )
      }
    }

    // Mark posted
    await supabase
      .from('social_post_drafts')
      .update({ status: 'posted', posted_at: new Date().toISOString() })
      .eq('id', id)

    return NextResponse.json({ ok: true, gbpOk, zapierOk })
  } catch (err) {
    console.error('[social-post-drafts POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to post draft' },
      { status: 500 },
    )
  }
}
