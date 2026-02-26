import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

/**
 * Zapier webhook: fetch recent sightings (last 24h).
 * Uses admin client (no user session in server route). Returns limited columns to reduce PII exposure.
 * Optional: set WEBHOOK_SIGHTINGS_SECRET and send in header x-webhook-secret or query ?secret= to restrict access.
 */
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.WEBHOOK_SIGHTINGS_SECRET
    if (secret) {
      const headerSecret = req.headers.get('x-webhook-secret')
      const querySecret = req.nextUrl.searchParams.get('secret')
      if (headerSecret !== secret && querySecret !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const supabase = createAdminClient()
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: sightings, error } = await supabase
      .from('sightings')
      .select('id, image_url, created_at')
      .gt('created_at', oneDayAgo)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Supabase Polling Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(
      {
        timestamp: new Date().toISOString(),
        count: sightings?.length || 0,
        sightings: sightings || [],
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('Webhook Error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    )
  }
}
