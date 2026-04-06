/**
 * Admin Social Posts API
 * Returns job feed history + promotional posts for the dashboard
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()

    // Fetch recent job posts — posted and queued
    const { data: jobPosts } = await admin
      .from('jobs')
      .select(
        `
        id,
        city,
        neighborhood,
        published_at,
        social_posted_at,
        image_url,
        ai_description,
        service:services(name)
      `,
      )
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50)

    // Fetch all promotional posts
    const { data: promoPosts } = await admin
      .from('promotional_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)

    // Weekly cap status — how many job posts have gone out this week
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { count: weeklyCount } = await admin
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .gte('social_posted_at', sevenDaysAgo.toISOString())

    // Count queued (published but not yet socially posted, valid city)
    const queuedCount = (jobPosts || []).filter(
      (j) => !j.social_posted_at && j.city,
    ).length

    return NextResponse.json({
      success: true,
      summary: {
        weekly_posts_sent: weeklyCount ?? 0,
        weekly_cap: 3,
        queued_jobs: queuedCount,
      },
      jobPosts: jobPosts || [],
      promoPosts: promoPosts || [],
    })
  } catch (error) {
    console.error('Social posts admin API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
