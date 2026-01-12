/**
 * Generate AI Description API Route
 * Generates professional job descriptions using Anthropic Claude
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'
import { generateJobDescription } from '@/lib/ai'

export async function POST(request: NextRequest) {
  console.log('🚀 [GENERATE] Starting generation request')
  
  try {
    // Check authentication
    console.log('🔐 [GENERATE] Step 1: Checking authentication...')
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      console.log('❌ [GENERATE] Authentication failed - no user')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.log('✅ [GENERATE] Authentication successful:', user.id)

    // Parse request body
    console.log('📥 [GENERATE] Step 2: Parsing request body...')
    const { jobId } = await request.json()
    console.log('📝 [GENERATE] Job ID received:', jobId)

    if (!jobId) {
      console.log('❌ [GENERATE] No job ID provided')
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      )
    }

    // Fetch job with service details (using join)
    console.log('🔍 [GENERATE] Step 3: Fetching job from database...')
    const { data: job, error: fetchError } = await supabase
      .from('jobs')
      .select(
        `
        id,
        raw_voice_input,
        city,
        neighborhood,
        ai_description,
        services (
          name
        )
      `
      )
      .eq('id', jobId)
      .single()

    if (fetchError) {
      console.error('❌ [GENERATE] Database fetch error:', fetchError)
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (!job) {
      console.log('❌ [GENERATE] Job not found in database')
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    console.log('✅ [GENERATE] Job fetched successfully:', {
      id: job.id,
      city: job.city,
      neighborhood: job.neighborhood,
      hasVoiceInput: !!job.raw_voice_input,
      hasDescription: !!job.ai_description,
      serviceName: job.services?.name,
    })

    // Check if job already has a description
    if (job.ai_description) {
      console.log('⚠️ [GENERATE] Job already has description')
      return NextResponse.json(
        { error: 'Job already has a description' },
        { status: 400 }
      )
    }

    // Validate required fields
    if (!job.raw_voice_input || !job.city) {
      console.log('❌ [GENERATE] Missing required fields:', {
        hasVoiceInput: !!job.raw_voice_input,
        hasCity: !!job.city,
      })
      return NextResponse.json(
        { error: 'Job missing required fields (voice note or city)' },
        { status: 400 }
      )
    }

    // Get service name from the joined data
    const serviceName = job.services?.name || 'Service'
    console.log('📋 [GENERATE] Service name:', serviceName)

    // Generate description using AI
    console.log('🤖 [GENERATE] Step 4: Calling AI to generate description...')
    console.log('📝 [GENERATE] Input data:', {
      voiceNote: job.raw_voice_input.substring(0, 100) + '...',
      serviceName,
      city: job.city,
      neighborhood: job.neighborhood,
    })

    const description = await generateJobDescription(
      job.raw_voice_input,
      serviceName,
      job.city,
      job.neighborhood
    )

    console.log('✅ [GENERATE] AI description generated successfully')
    console.log('📄 [GENERATE] Description length:', description.length, 'characters')
    console.log('📄 [GENERATE] Description preview:', description.substring(0, 100) + '...')

    // Update job with generated description
    console.log('💾 [GENERATE] Step 5: Updating database with description...')
    const { error: updateError } = await supabase
      .from('jobs')
      .update({ ai_description: description })
      .eq('id', jobId)

    if (updateError) {
      console.error('❌ [GENERATE] Database update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update job' },
        { status: 500 }
      )
    }

    console.log('✅ [GENERATE] Database updated successfully')

    // Return success with the generated description
    console.log('🎉 [GENERATE] Generation complete!')
    return NextResponse.json({
      success: true,
      description,
    })
  } catch (error) {
    console.error('💥 [GENERATE] FATAL ERROR:', error)
    console.error('💥 [GENERATE] Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    console.error('💥 [GENERATE] Error message:', error instanceof Error ? error.message : String(error))
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
