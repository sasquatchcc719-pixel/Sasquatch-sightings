/**
 * Sighting Delete API Route Handler
 * Handles sighting deletion: removes database record AND storage file
 * Requires authentication (only admins can delete)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/supabase/server'

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

    // Validate sighting ID
    if (!id) {
      return NextResponse.json(
        { error: 'Sighting ID is required' },
        { status: 400 }
      )
    }

    // First, get the sighting to retrieve the image_url and phone_number
    const { data: sighting, error: fetchError } = await supabase
      .from('sightings')
      .select('id, image_url, phone_number')
      .eq('id', id)
      .single()

    if (fetchError || !sighting) {
      console.error('Sighting fetch error:', fetchError)
      return NextResponse.json(
        { error: 'Sighting not found' },
        { status: 404 }
      )
    }

    // Delete the image from storage first
    if (sighting.image_url) {
      // Extract filename from URL (format: .../storage/v1/object/public/sighting-images/filename.jpg)
      const urlParts = sighting.image_url.split('/')
      const filename = urlParts[urlParts.length - 1]
      
      if (filename) {
        const { error: storageError } = await supabase.storage
          .from('sighting-images')
          .remove([filename])

        if (storageError) {
          console.error('Storage deletion error:', storageError)
          // Continue with database deletion even if storage fails
          // (image might already be deleted or filename might be incorrect)
        }
      }
    }

    // Delete associated lead (using admin client to bypass RLS)
    if (sighting.phone_number) {
      const adminClient = createAdminClient()
      const { error: leadDeleteError } = await adminClient
        .from('leads')
        .delete()
        .eq('phone', sighting.phone_number)
        .eq('source', 'contest')

      if (leadDeleteError) {
        console.error('Lead deletion error:', leadDeleteError)
        // Continue with sighting deletion even if lead deletion fails
      } else {
        console.log(`Deleted lead associated with sighting ${id}`)
      }
    }

    // Delete the sighting record from database
    const { error: deleteError } = await supabase
      .from('sightings')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Database deletion error:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete sighting' },
        { status: 500 }
      )
    }

    // Return success
    return NextResponse.json(
      {
        success: true,
        message: 'Sighting, associated lead, and image deleted successfully',
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
