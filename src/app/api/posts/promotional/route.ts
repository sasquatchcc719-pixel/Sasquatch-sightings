/**
 * Promotional Posts Feed — Offer & Event posts for Google Business Profile
 *
 * Separate from the job completion feed. This generates:
 *   - OFFER posts: once per month, seasonal deal with a real expiration date
 *   - EVENT posts: once per quarter, season-long campaign (Spring Cleaning Season, etc.)
 *
 * Each post gets a DALL-E 3 generated image — a warm Colorado interior shot
 * that matches the season. Images are stored in Supabase storage.
 *
 * Zapier/n8n polls this on a monthly schedule. Returns 1 post if one is due,
 * empty if not. Marks as posted after returning so it never duplicates.
 */

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createAdminClient } from '@/supabase/server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ─── Seasonal data ────────────────────────────────────────────────────────────

type Season = 'spring' | 'summer' | 'fall' | 'winter'

function getSeason(month: number): Season {
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'fall'
  return 'winter'
}

function getQuarter(month: number): number {
  return Math.ceil(month / 3)
}

const SEASONAL_OFFER_CONTEXT: Record<Season, string> = {
  spring: `Spring is the #1 carpet cleaning season in Colorado. People are doing deep cleans, opening windows, and dealing with winter salt/sand tracked in all season. Frame this as a "Spring Deep Clean" offer. Reference Colorado spring weather (mud season, allergens kicking in, pets shedding).`,
  summer: `Summer in Colorado means kids home all day, BBQs, outdoor traffic in and out, and pets. Frame this as a "Summer Refresh" offer — getting ahead of the mess before it sets in. Reference the dry Colorado heat which actually makes carpets easier to clean and dry faster.`,
  fall: `Fall is prime time for getting carpets clean before the holidays. People have guests coming, kids back in school with new shoe traffic, and want the house looking good. Frame this as a "Before the Holidays" or "Fall Reset" offer.`,
  winter: `Winter in Colorado means salt, sand, and slush tracked in constantly. Also a slower season so this is a good time for a deal. Frame this as a "New Year Fresh Start" or "Winter Clean" offer. Mention that hot water extraction is actually perfect in winter — carpets dry fast with the heat running.`,
}

const SEASONAL_EVENT_CONTEXT: Record<
  Season,
  { name: string; description: string; months: string }
> = {
  spring: {
    name: 'Spring Cleaning Season',
    description:
      'The busiest carpet cleaning season of the year in Colorado. Position this as the annual spring refresh event — the time to finally deal with winter damage and get ahead of allergy season.',
    months: 'March through May',
  },
  summer: {
    name: 'Summer Refresh Event',
    description:
      'Kids home, outdoor traffic constant, pets everywhere. Position this as the summer maintenance event — keeping carpets clean through the busiest home-traffic season.',
    months: 'June through August',
  },
  fall: {
    name: 'Holiday Home Prep',
    description:
      'Get the house ready before guests arrive. Position this as the pre-holiday clean event — the smart move before Thanksgiving and Christmas.',
    months: 'September through November',
  },
  winter: {
    name: 'New Year Fresh Start',
    description:
      'New year, clean home. Salt and sand have been tracked in all winter. Position this as the fresh start event — a clean slate going into the new year.',
    months: 'December through February',
  },
}

const SEASONAL_IMAGE_PROMPTS: Record<Season, string> = {
  spring: `A bright, freshly cleaned living room in a Colorado mountain home. Large windows showing green trees and blue Colorado sky. Plush, clean beige or cream carpet. Natural light flooding in. Fresh flowers on a side table. Warm and inviting. No people. Photorealistic interior photography style. High quality.`,
  summer: `A clean, airy living room in a Colorado home on a sunny summer day. Mountains visible through large windows. Light-colored clean carpet. A ceiling fan. Bright and cheerful. Children's shoes neatly by the door. No people. Photorealistic interior photography style. High quality.`,
  fall: `A cozy living room in a Colorado home decorated for fall. Warm amber light. Clean plush carpet in a rich neutral tone. A fireplace, fall leaves visible outside the window. Warm blanket on a couch. No people. Photorealistic interior photography style. High quality.`,
  winter: `A cozy living room in a Colorado mountain home in winter. Snow visible through the windows. Warm interior lighting. Clean, plush carpet. A fireplace glowing. Hot cocoa on a coffee table. Holiday-adjacent but not overtly Christmas. No people. Photorealistic interior photography style. High quality.`,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateOfferPost(season: Season, month: number, year: number) {
  // Offer expires end of the month
  const offerStart = new Date(year, month - 1, 1)
  const offerEnd = new Date(year, month, 0) // last day of month

  const { choices } = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.8,
    max_tokens: 400,
    messages: [
      {
        role: 'system',
        content: `You write Google Business Profile OFFER posts for Sasquatch Carpet Cleaning in Monument, Colorado. They serve Monument, Palmer Lake, Woodmoor, Gleneagle, Black Forest, Castle Rock, Larkspur, and Colorado Springs neighborhoods.

Write in a warm, professional tone. NOT salesy. Sound like a real local business owner talking to neighbors.

Return JSON with these exact fields:
{
  "title": "short punchy offer title (max 58 chars)",
  "body": "2-3 sentences. Specific, local, seasonal. End with: Serving Monument, Palmer Lake, and the Tri-Lakes area — book online or call (719) 249-8791",
  "coupon_code": "optional short code like SPRING25 or leave empty string"
}`,
      },
      {
        role: 'user',
        content: `Write a ${season} offer post for ${offerStart.toLocaleString('default', { month: 'long' })} ${year}. Context: ${SEASONAL_OFFER_CONTEXT[season]}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const parsed = JSON.parse(choices[0].message.content || '{}')
  return {
    title:
      parsed.title ||
      `${season.charAt(0).toUpperCase() + season.slice(1)} Carpet Cleaning Special`,
    body: parsed.body || '',
    coupon_code: parsed.coupon_code || null,
    offer_start_date: offerStart.toISOString().split('T')[0],
    offer_end_date: offerEnd.toISOString().split('T')[0],
  }
}

async function generateEventPost(
  season: Season,
  quarter: number,
  year: number,
) {
  const eventData = SEASONAL_EVENT_CONTEXT[season]

  const { choices } = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.8,
    max_tokens: 400,
    messages: [
      {
        role: 'system',
        content: `You write Google Business Profile EVENT posts for Sasquatch Carpet Cleaning in Monument, Colorado. They serve Monument, Palmer Lake, Woodmoor, Gleneagle, Black Forest, Castle Rock, Larkspur, and Colorado Springs neighborhoods.

Write in a warm, professional tone. Sound like a real local business owner.

Return JSON with these exact fields:
{
  "title": "event name, max 58 chars",
  "body": "2-3 sentences about why this season matters for carpet cleaning in Colorado. Specific and local. End with: Book online or call (719) 249-8791 — we serve the entire Tri-Lakes area and Colorado Springs."
}`,
      },
      {
        role: 'user',
        content: `Write a ${season} event post for Q${quarter} ${year}. Event name: "${eventData.name}". Runs: ${eventData.months}. Context: ${eventData.description}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const parsed = JSON.parse(choices[0].message.content || '{}')

  // Event spans the whole season (roughly 3 months)
  const seasonStartMonth = { spring: 3, summer: 6, fall: 9, winter: 12 }[season]
  const eventStart = new Date(year, seasonStartMonth - 1, 1)
  const eventEnd = new Date(year, seasonStartMonth + 2, 0)

  return {
    title: parsed.title || eventData.name,
    body: parsed.body || '',
    offer_start_date: eventStart.toISOString().split('T')[0],
    offer_end_date: eventEnd.toISOString().split('T')[0],
  }
}

async function generateAndUploadImage(
  season: Season,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string | null> {
  try {
    // Generate image with DALL-E 3
    const imageResponse = await openai.images.generate({
      model: 'dall-e-3',
      prompt: SEASONAL_IMAGE_PROMPTS[season],
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    })

    const imageUrl = imageResponse.data?.[0]?.url
    if (!imageUrl) return null

    // Download the image
    const imageBuffer = await fetch(imageUrl).then((r) => r.arrayBuffer())

    // Upload to Supabase storage
    const filename = `promotional/${season}-${Date.now()}.png`
    const { error } = await supabase.storage
      .from('promotional-images')
      .upload(filename, imageBuffer, {
        contentType: 'image/png',
        upsert: false,
      })

    if (error) {
      console.error('Storage upload error:', error)
      // Fall back to the temporary DALL-E URL (expires in ~1hr, but Zapier will use it fast)
      return imageUrl
    }

    // Return public URL
    const { data: publicData } = supabase.storage
      .from('promotional-images')
      .getPublicUrl(filename)

    return publicData.publicUrl
  } catch (err) {
    console.error('Image generation error:', err)
    return null
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // Optional secret to prevent random people from triggering image generation
    const secret = request.nextUrl.searchParams.get('secret')
    if (
      process.env.PROMOTIONAL_FEED_SECRET &&
      secret !== process.env.PROMOTIONAL_FEED_SECRET
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()
    const now = new Date()
    const month = now.getMonth() + 1 // 1-12
    const year = now.getFullYear()
    const quarter = getQuarter(month)
    const season = getSeason(month)

    // Check if we already have an OFFER post for this month
    const { data: existingOffer } = await supabase
      .from('promotional_posts')
      .select('id, social_posted_at')
      .eq('post_type', 'OFFER')
      .eq('month', month)
      .eq('year', year)
      .maybeSingle()

    // Check if we already have an EVENT post for this quarter
    const { data: existingEvent } = await supabase
      .from('promotional_posts')
      .select('id, social_posted_at')
      .eq('post_type', 'EVENT')
      .eq('quarter', quarter)
      .eq('year', year)
      .maybeSingle()

    // Look for any unposted promotional content first
    const unpostedOffer =
      existingOffer && !existingOffer.social_posted_at ? existingOffer : null
    const unpostedEvent =
      existingEvent && !existingEvent.social_posted_at ? existingEvent : null

    // If we have unposted content ready, return it
    if (unpostedOffer || unpostedEvent) {
      const targetId = (unpostedOffer || unpostedEvent)!.id
      const { data: post } = await supabase
        .from('promotional_posts')
        .select('*')
        .eq('id', targetId)
        .single()

      // Mark as posted
      await supabase
        .from('promotional_posts')
        .update({ social_posted_at: now.toISOString() })
        .eq('id', targetId)

      return NextResponse.json({ success: true, count: 1, posts: [post] })
    }

    // Generate new content if needed
    const postsToCreate = []

    // Generate OFFER if we don't have one for this month
    if (!existingOffer) {
      const offerData = await generateOfferPost(season, month, year)
      const imageUrl = await generateAndUploadImage(season, supabase)

      const { data: newOffer } = await supabase
        .from('promotional_posts')
        .insert({
          post_type: 'OFFER',
          season,
          year,
          month,
          quarter,
          title: offerData.title,
          body: offerData.body,
          image_url: imageUrl,
          coupon_code: offerData.coupon_code,
          offer_start_date: offerData.offer_start_date,
          offer_end_date: offerData.offer_end_date,
        })
        .select()
        .single()

      if (newOffer) postsToCreate.push(newOffer)
    }

    // Generate EVENT if we don't have one for this quarter
    if (!existingEvent) {
      const eventData = await generateEventPost(season, quarter, year)
      // Reuse image from offer if we just generated one, else generate new
      const imageUrl =
        postsToCreate[0]?.image_url ??
        (await generateAndUploadImage(season, supabase))

      const { data: newEvent } = await supabase
        .from('promotional_posts')
        .insert({
          post_type: 'EVENT',
          season,
          year,
          month,
          quarter,
          title: eventData.title,
          body: eventData.body,
          image_url: imageUrl,
          offer_start_date: eventData.offer_start_date,
          offer_end_date: eventData.offer_end_date,
        })
        .select()
        .single()

      if (newEvent) postsToCreate.push(newEvent)
    }

    if (postsToCreate.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        posts: [],
        message: 'All promotional content for this period already posted.',
      })
    }

    // Return only the first post — next poll will get the second
    const toReturn = postsToCreate.slice(0, 1)
    await supabase
      .from('promotional_posts')
      .update({ social_posted_at: now.toISOString() })
      .in(
        'id',
        toReturn.map((p) => p.id),
      )

    return NextResponse.json({
      success: true,
      count: toReturn.length,
      posts: toReturn,
    })
  } catch (error) {
    console.error('Promotional posts feed error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
