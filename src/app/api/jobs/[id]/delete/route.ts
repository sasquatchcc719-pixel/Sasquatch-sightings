/**
 * Job Delete API Route Handler
 * Handles job deletion: removes database record AND storage file
 * Requires authentication (only admins can delete)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check authentication
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Validate job ID
    if (!id) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      )
    }

    // First, get the job to retrieve the image_filename
    const { data: job, error: fetchError } = await supabase
      .from('jobs')
      .select('id, image_filename')
      .eq('id', id)
      .single()

    if (fetchError || !job) {
      console.error('Job fetch error:', fetchError)
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    // Delete the image from storage first
    if (job.image_filename) {
      const { error: storageError } = await supabase.storage
        .from('job-images')
        .remove([job.image_filename])

      if (storageError) {
        console.error('Storage deletion error:', storageError)
        // Continue with database deletion even if storage fails
        // (image might already be deleted or filename might be incorrect)
      }
    }

    // Delete the job record from database
    const { error: deleteError } = await supabase
      .from('jobs')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Database deletion error:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete job' },
        { status: 500 }
      )
    }

    // Return success
    return NextResponse.json(
      {
        success: true,
        message: 'Job and associated image deleted successfully',
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Delete API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
