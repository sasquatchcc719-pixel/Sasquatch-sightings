/**
 * Weekly cron: generate AI-drafted social posts for review.
 * Runs every Monday at 07:00 UTC.
 *
 * Looks at recent job data to pick the best post type (milestone, local SEO,
 * educational, seasonal tip, behind the scenes), generates copy with Claude,
 * and saves a draft for the admin to review and approve.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  generateSocialDraft,
  type SocialDraftType,
  type SocialDraftContext,
} from '@/lib/ai'

// How many days back to look at job data
const LOOKBACK_DAYS = 30

// Don't generate a new draft if one is already sitting unreviewed
const MAX_PENDING_DRAFTS = 3

type JobRow = {
  city: string | null
  published_at: string
  service: { name: string } | null
}

type DraftRow = {
  post_type: string
  created_at: string
}

function getMostFrequent(arr: string[]): string | undefined {
  const counts: Record<string, number> = {}
  for (const v of arr) counts[v] = (counts[v] ?? 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
}

function pickPostType(
  recentDraftTypes: string[],
  hasNewMilestone: boolean,
): SocialDraftType {
  if (hasNewMilestone) return 'milestone'

  // Rotate through types, preferring the one least recently used
  const rotation: SocialDraftType[] = [
    'local_seo',
    'educational',
    'seasonal_tip',
    'behind_scenes',
    'educational',
    'local_seo',
  ]

  // Find first type that hasn't been used in the last 2 drafts
  const recentTwo = recentDraftTypes.slice(0, 2)
  return rotation.find((t) => !recentTwo.includes(t)) ?? 'educational'
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const now = new Date()
    const lookbackDate = new Date(now)
    lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS)

    // Check how many drafts are already pending review
    const { count: pendingCount } = await supabase
      .from('social_post_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'draft')

    if ((pendingCount ?? 0) >= MAX_PENDING_DRAFTS) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `${pendingCount} drafts already pending review — skipping generation`,
      })
    }

    // Pull recent jobs
    const { data: recentJobs } = await supabase
      .from('jobs')
      .select('city, published_at, service:services(name)')
      .eq('status', 'published')
      .gte('published_at', lookbackDate.toISOString())
      .order('published_at', { ascending: false })
      .limit(50)

    const jobs = (recentJobs ?? []) as unknown as JobRow[]
    const cities = jobs.map((j) => j.city).filter(Boolean) as string[]
    const services = jobs
      .map((j) => (j.service as { name: string } | null)?.name)
      .filter(Boolean) as string[]

    const topCity = getMostFrequent(cities)
    const topService = getMostFrequent(services)
    const uniqueCities = [...new Set(cities)]

    // Check for city milestones (multiples of 25)
    let milestoneContext: SocialDraftContext | null = null
    if (topCity) {
      const { count: cityJobCount } = await supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'published')
        .eq('city', topCity)

      const total = cityJobCount ?? 0
      // Hit a milestone if we're within 2 of a multiple of 25 and haven't posted it yet
      const nearestMilestone = Math.floor(total / 25) * 25
      if (nearestMilestone > 0 && total - nearestMilestone <= 2) {
        // Make sure we haven't already generated a milestone draft for this count
        const { count: existingMilestone } = await supabase
          .from('social_post_drafts')
          .select('id', { count: 'exact', head: true })
          .eq('post_type', 'milestone')
          .contains('context_data', {
            milestoneCount: nearestMilestone,
            city: topCity,
          })

        if ((existingMilestone ?? 0) === 0) {
          milestoneContext = {
            city: topCity,
            milestoneCount: nearestMilestone,
            milestoneLabel: `${nearestMilestone} jobs completed in ${topCity}`,
          }
        }
      }
    }

    // Pull recent draft types to avoid repetition
    const { data: recentDrafts } = await supabase
      .from('social_post_drafts')
      .select('post_type, created_at')
      .order('created_at', { ascending: false })
      .limit(5)

    const recentDraftTypes = ((recentDrafts ?? []) as DraftRow[]).map(
      (d) => d.post_type,
    )

    const postType = pickPostType(recentDraftTypes, !!milestoneContext)

    const context: SocialDraftContext = milestoneContext ?? {
      city: topCity,
      service: topService,
      recentCities: uniqueCities.slice(0, 5),
      month: now.getMonth() + 1,
    }

    // Generate the draft copy
    const { title, body } = await generateSocialDraft(postType, context)

    // Save draft
    const { data: draft, error: insertError } = await supabase
      .from('social_post_drafts')
      .insert({
        post_type: postType,
        title,
        body,
        status: 'draft',
        context_data: context,
      })
      .select()
      .single()

    if (insertError) throw insertError

    console.log(
      `[social-draft-generator] Created ${postType} draft: ${draft.id}`,
    )

    return NextResponse.json({
      ok: true,
      draft: { id: draft.id, post_type: postType, title },
    })
  } catch (err) {
    console.error('[social-draft-generator] Error:', err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to generate draft',
      },
      { status: 500 },
    )
  }
}
