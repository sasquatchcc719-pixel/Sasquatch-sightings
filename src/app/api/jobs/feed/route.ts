/**
 * Jobs Feed API Route Handler
 * Public endpoint for Zapier integration - returns recently published jobs
 * No authentication required
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()

    // Calculate timestamp for 24 hours ago
    const twentyFourHoursAgo = new Date()
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)

    // Fetch jobs published in the last 24 hours
    const { data: jobs, error } = await supabase
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
      `
      )
      .eq('status', 'published')
      .gte('published_at', twentyFourHoursAgo.toISOString())
      .order('published_at', { ascending: false })

    if (error) {
      console.error('Error fetching jobs feed:', error)
      return NextResponse.json(
        { error: 'Failed to fetch jobs' },
        { status: 500 }
      )
    }

    // Format response for Zapier
    const formattedJobs = (jobs || []).map((job) => ({
      id: job.id,
      title: `${(job.service as any)?.name || 'Service'} in ${job.city}${job.neighborhood ? `, ${job.neighborhood}` : ''}`,
      description: job.ai_description,
      image_url: job.image_url,
      city: job.city,
      published_at: job.published_at,
    }))

    return NextResponse.json(
      {
        success: true,
        count: formattedJobs.length,
        jobs: formattedJobs,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Jobs feed API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
