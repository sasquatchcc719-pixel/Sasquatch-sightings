/**
 * Jobs Feed API Route Handler
 * Public endpoint for Zapier integration — returns the next unposted job
 * and marks it as posted so it never appears again.
 *
 * Rules:
 *  - Max 3 posts per rolling 7-day window (quality over quantity)
 *  - Never posts jobs with unknown/blank city
 *  - Each job is marked with social_posted_at on first return (no duplicates)
 *  - Returns 1 job per call — Zapier should poll daily
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { isUnknownCity } from '@/lib/geocode'

// Maximum Google Business posts per 7-day rolling window
const WEEKLY_POST_CAP = 3

// Human-sounding title templates — rotated so posts don't look identical
const TITLE_TEMPLATES = [
  (service: string, location: string) => `${service} — ${location}`,
  (service: string, location: string) =>
    `Just finished: ${service} in ${location}`,
  (service: string, location: string) => `${location} — ${service} complete`,
  (service: string, location: string) => `Fresh results from ${location}`,
  (service: string, location: string) => `${service} completed in ${location}`,
  (service: string, location: string) => `Another great job in ${location}`,
]

// Google Business post types — rotated to add variety to the profile
const POST_TYPES = [
  'STANDARD',
  'STANDARD',
  'STANDARD',
  'OFFER',
  'STANDARD',
  'STANDARD',
]

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Check how many jobs we've already posted this week
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { count: weeklyCount } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .gte('social_posted_at', sevenDaysAgo.toISOString())

    if ((weeklyCount ?? 0) >= WEEKLY_POST_CAP) {
      // Weekly cap reached — tell Zapier nothing to post
      return NextResponse.json({
        success: true,
        count: 0,
        jobs: [],
        message: `Weekly cap of ${WEEKLY_POST_CAP} posts reached. Next slot opens as posts age out.`,
      })
    }

    // Fetch unposted published jobs — skip any with unknown/blank city
    const { data: candidates, error } = await supabase
      .from('jobs')
      .select(
        `
        id,
        ai_description,
        image_url,
        city,
        neighborhood,
        published_at,
        service:services(name)
      `,
      )
      .eq('status', 'published')
      .is('social_posted_at', null)
      .order('published_at', { ascending: false })
      .limit(20) // fetch more than we need so we can filter unknown cities

    if (error) {
      console.error('Error fetching jobs feed:', error)
      return NextResponse.json(
        { error: 'Failed to fetch jobs' },
        { status: 500 },
      )
    }

    // Filter out unknown/blank cities — these produce garbage post titles
    const validJobs = (candidates || []).filter(
      (job) => job.city && !isUnknownCity(job.city),
    )

    if (validJobs.length === 0) {
      return NextResponse.json({ success: true, count: 0, jobs: [] })
    }

    // Take only 1 job this call — Zapier polls daily, so 1/day = max 7/week
    // but the weekly cap above trims that to 3
    const jobsToPost = validJobs.slice(0, 1)

    // Mark each selected job as posted so it never comes through again
    const idsToMark = jobsToPost.map((j) => j.id)
    await supabase
      .from('jobs')
      .update({ social_posted_at: new Date().toISOString() })
      .in('id', idsToMark)

    // Format for Zapier
    const formattedJobs = jobsToPost.map((job, i) => {
      const serviceName = (job.service as any)?.name || 'Carpet Cleaning'
      const location = job.neighborhood
        ? `${job.neighborhood}, ${job.city}`
        : job.city!

      // Rotate title and post_type by a hash of the job id so it's consistent
      // but varies across different jobs
      const idx = job.id.charCodeAt(0) % TITLE_TEMPLATES.length
      const title = TITLE_TEMPLATES[idx](serviceName, location)
      const post_type = POST_TYPES[idx % POST_TYPES.length]

      return {
        id: job.id,
        title,
        description: job.ai_description,
        image_url: job.image_url,
        city: job.city,
        neighborhood: job.neighborhood ?? null,
        location,
        service: serviceName,
        post_type,
        published_at: job.published_at,
      }
    })

    return NextResponse.json({
      success: true,
      count: formattedJobs.length,
      weekly_posts_remaining:
        WEEKLY_POST_CAP - (weeklyCount ?? 0) - formattedJobs.length,
      jobs: formattedJobs,
    })
  } catch (error) {
    console.error('Jobs feed API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
