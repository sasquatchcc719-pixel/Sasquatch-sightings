/**
 * Job Update API Route
 * Handles updating job fields (description, status, published_at)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    // Check authentication
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get job ID from params
    const { id: jobId } = await context.params

    // Parse request body
    const body = await request.json()
    const { ai_description, status, published_at } = body

    // Build update object with only provided fields
    const updates: {
      ai_description?: string
      status?: string
      published_at?: string
    } = {}

    if (ai_description !== undefined) {
      updates.ai_description = ai_description
    }

    if (status !== undefined) {
      updates.status = status
    }

    if (published_at !== undefined) {
      updates.published_at = published_at
    }

    // Update job in database
    const { data: job, error: updateError } = await supabase
      .from('jobs')
      .update(updates)
      .eq('id', jobId)
      .select()
      .single()

    if (updateError) {
      console.error('Database update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update job' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, job })
  } catch (error) {
    console.error('Job update API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
